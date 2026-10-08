"""Server-side browsing of the library in pages (issue #221).

- :mod:`.paths` - folder membership as indexed SQL comparisons.
- :mod:`.tag_query` - the browse views' tag filter expression, in SQL.
- :mod:`.media` - filtering, sorting, paging and folder grouping for the media
  galleries.

The system shelf's equivalent lives with its router
(``routers/systems/books.py``), since it reuses the search API's book filters.
Submodules are imported directly rather than re-exported here, so importing the
package does not pull in the tag service.
"""
