"""Library scans and the background work that follows them.

``runner`` holds the scan's shared status and stop flag and runs rescans and the
deferred OCR and model-thumbnail queues; ``reindex_queue`` re-indexes single
books after a replace upload; ``claims`` keeps two of those off the same book.
The library, files, books, maintenance and duplicates routers, the scheduler,
the library watcher and startup all drive them.
"""
