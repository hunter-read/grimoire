"""Opt-in paging for the OPDS acquisition feeds (issue #706).

A feed URL carrying ``?page_size=N`` splits every acquisition feed into pages of
N books, linked with ``first``/``previous``/``next``/``last`` (RFC 5005) and
described with OpenSearch totals. Without it each feed lists every book in one
document, exactly as it always has, so a reader already subscribed sees no
change. The parameter is carried on every link back into the catalog, so
setting it once on the root URL pages the whole catalog.
"""
from dataclasses import dataclass
from typing import Optional
from xml.sax.saxutils import escape

from fastapi import Depends, Query

MAX_PAGE_SIZE = 500

OPENSEARCH_NS = 'xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"'


@dataclass(frozen=True)
class Paging:
    """The requested page: ``size`` is ``None`` when the feed is unpaged."""

    size: Optional[int] = None
    page: int = 1

    @property
    def offset(self) -> int:
        return (self.page - 1) * (self.size or 0)


def page_size_param(
    page_size: Optional[int] = Query(
        None,
        ge=1,
        le=MAX_PAGE_SIZE,
        description=(
            "Split acquisition feeds into pages of this many books. Omit for one "
            "unpaged feed. Carried on every link back into the catalog."
        ),
    ),
) -> Optional[int]:
    return page_size


def paging_params(
    page_size: Optional[int] = Depends(page_size_param),
    page: int = Query(1, ge=1, description="Page number, from 1. Ignored without page_size."),
) -> Paging:
    return Paging(page_size, page if page_size else 1)


def with_page_size(url: str, page_size: Optional[int]) -> str:
    """``url`` with ``page_size`` carried on it, or unchanged when unpaged."""
    return f"{url}?page_size={page_size}" if page_size else url


def page_links(feed_url: str, paging: Paging, total: int, link_type: str) -> str:
    """The self/first/previous/next/last links and OpenSearch totals of one page."""
    assert paging.size, "page_links is only for a paged feed"
    last = max(1, -(-total // paging.size))

    def link(rel: str, page: int) -> str:
        href = f"{feed_url}?page_size={paging.size}&page={page}"
        return f'<link rel="{rel}" href="{escape(href)}" type="{link_type}"/>'

    links = [link("self", paging.page), link("first", 1)]
    if paging.page > 1:
        # A page past the end (the library shrank since the link was handed
        # out) points back at the real last page rather than another empty one.
        links.append(link("previous", min(paging.page - 1, last)))
    if paging.page < last:
        links.append(link("next", paging.page + 1))
    links.append(link("last", last))
    return (
        "".join(links)
        + f"<opensearch:totalResults>{total}</opensearch:totalResults>"
        + f"<opensearch:itemsPerPage>{paging.size}</opensearch:itemsPerPage>"
        + f"<opensearch:startIndex>{paging.offset + 1}</opensearch:startIndex>"
    )
