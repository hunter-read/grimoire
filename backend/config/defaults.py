"""Fixed settings that are not read from the environment."""

# Rendered pages are content-addressed (the cache key includes a digest of the
# file's bytes), so a given URL's body can never change — hence "immutable".
# Replacing the file changes the token and therefore the URL.
_PAGE_CACHE_HEADERS = {"Cache-Control": "max-age=31536000, immutable"}

# Original media files (a 50MB battlemap, an animated .webm) are served straight
# off disk at their full size, and unlike rendered pages their URL is not
# content-addressed — replacing the file on disk reuses the same URL. So they
# get a short private TTL rather than "immutable": long enough that paging back
# and forth through a folder does not re-download what was just fetched, short
# enough that a replaced file shows up quickly and the browser cache is not
# holding hundreds of megabytes of originals.
_MEDIA_FILE_CACHE_HEADERS = {"Cache-Control": "private, max-age=300"}

# Media thumbnails (map/token grid cards). Unlike rendered pages these are NOT
# content-addressed — the URL is /maps/{id}/thumbnail and stays the same when the
# underlying image is replaced — so they must not be "immutable", or a browser
# would never re-check and a replaced map would show its old thumbnail forever.
# "no-cache" still caches the bytes; it just requires a revalidation, which the
# ETag then answers with a cheap 304. They are also access-controlled (guests see
# only what is shared with them; tokens can be flagged explicit), so the entry is
# "private" — a shared proxy must never hand one user's thumbnail to another.
_THUMBNAIL_CACHE_HEADERS = {"Cache-Control": "private, no-cache"}

# Where the template browser fetches its catalogue from. An operator can point
# this at a fork or a private mirror; the UI keeps the default and hides the
# override behind a toggle, so the common case is one click.
DEFAULT_WIKI_TEMPLATE_INDEX_URL = (
    "https://raw.githubusercontent.com/grimoire-codex/community-add-ons/main/"
    "templates/index.json"
)

# Where the theme browser fetches its catalogue from. Same repository as
# add-ons and templates, under `themes/`; an operator can point it at a fork.
DEFAULT_THEME_INDEX_URL = (
    "https://raw.githubusercontent.com/grimoire-codex/community-add-ons/main/"
    "themes/index.json"
)
