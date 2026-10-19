"""Rendering PDF, EPUB and DjVu pages, in-process or in a pool of worker processes.

Kept light on purpose: a render worker imports ``backend.render.worker`` and
pays for this package and nothing more, so its baseline is PyMuPDF and Pillow
rather than the whole app. Import ``backend.render.pool`` for the public API.
"""
