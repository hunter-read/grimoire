"""The GM screen: a campaign's board of built-in tools (issue #764).

* ``panels`` - the panel kinds, cleaning their config and state, resets, and
  placing panels on the grid
* ``boards`` - whole boards as documents: presets, exports and copies
* ``presets`` - the community catalogue of ready-made boards
"""
from . import boards, panels, presets

__all__ = ["boards", "panels", "presets"]
