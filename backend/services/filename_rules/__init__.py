"""Filename rules: what a library's own naming conventions mean to Grimoire.

Two mechanisms that both start from "the filename already says it", split by
what they read:

* ``pattern``  - the folder naming pattern language: one string that reads a
  title (and publisher, version, ...) out of a filename, and writes a filename
  back from metadata (issues #521 and #522)
* ``folders``  - which folder's pattern applies to a book, and carrying patterns
  along when the file manager renames, moves or deletes a folder
* ``renames``  - previewing and applying a pattern to books already indexed
* ``variant_rules`` - a library's own markers for variant kinds and labels,
  checked before the built-in ones during duplicate review (issue #569)

Nothing is re-exported here on purpose. ``library_fs``, the indexer and the
duplicate scan each need one of these modules, and some of those modules need
them back; importing a submodule directly keeps every one of those edges from
dragging the rest of the package (and its imports) along with it.
"""
