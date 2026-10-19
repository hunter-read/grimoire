"""Re-export of ``backend.render.outline``, where the TOC reader now lives.

It moved so a render worker can read a table of contents without importing the
indexer package (issue #615).
"""
from ..render.outline import read_toc  # noqa: F401
