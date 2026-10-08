"""The browse views' tag filter, evaluated in SQL (issue #221).

The filter is the grouped boolean expression the frontend builds
(``components/library/tagQuery.js``): a list of groups, tags OR'd within a group
and every group required, each group either ``include`` ("any of") or
``exclude`` ("none of"). The ``__grim:none__`` / ``__grim:any__`` sentinels mean
"carries no tag at all" / "carries at least one".

It used to run in the browser over the whole downloaded collection. Paging
means the server has to apply it, with the same meaning: for media an item's
tags are its *effective* tags - its own plus those of every folder above it -
and for books just the book's own.
"""
from __future__ import annotations

import json
from typing import Any, Optional

from sqlalchemy import and_, bindparam, false, not_, or_, select, true
from sqlalchemy.orm import Session

from ...models import ResourceTag, Tag
from .. import variants
from ..tag_service import FolderResolver, normalize_internal, tagged_folders
from ..tag_service._folder_scopes import outermost
from .paths import folder_column

FILTER_NONE = "__grim:none__"
FILTER_ANY = "__grim:any__"
GROUP_EXCLUDE = "exclude"


def parse_tag_groups(raw: Optional[str]) -> list[dict]:
    """The ``tags`` query parameter (JSON) as a list of non-empty groups.

    Accepts what ``toGroups`` accepts: a list of ``{mode, tags}`` groups, or the
    legacy flat list of tag strings (one include group per tag, i.e. "all of
    these"). Raises ``ValueError`` on anything else, for the caller to turn into
    a 400 rather than silently ignoring a filter the user set.
    """
    if not raw:
        return []
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("tags must be JSON") from exc
    if not isinstance(value, list):
        raise ValueError("tags must be a JSON list")
    first = next((v for v in value if v is not None), None)
    if isinstance(first, dict):
        groups = [
            {
                "mode": GROUP_EXCLUDE if g.get("mode") == GROUP_EXCLUDE else "include",
                "tags": [t for t in g.get("tags") or [] if isinstance(t, str)],
            }
            for g in value
            if isinstance(g, dict) and isinstance(g.get("tags"), list)
        ]
    else:
        groups = [{"mode": "include", "tags": [t]} for t in value if isinstance(t, str)]
    return [g for g in groups if g["tags"]]


class TagMatcher:
    """Builds "carries tag X" clauses for one collection's rows.

    ``folder_tags`` makes a folder's tags count as tags on everything beneath
    it, which is how the media galleries have always read them; books filter on
    their own tags only.
    """

    def __init__(self, db: Session, resource_type: str, model: Any, *, folder_tags: bool):
        self.db = db
        self.resource_type = resource_type
        self.model = model
        self.folders = tagged_folders(db, resource_type) if folder_tags else []
        self.resolver = FolderResolver(db)
        self._all_folders: Optional[list[str]] = None

    def _direct(self, tag_filter: Any) -> Any:
        """Rows linked to a tag matching ``tag_filter`` (a clause on ``Tag``)."""
        linked = (
            select(ResourceTag.resource_id)
            .join(Tag, Tag.id == ResourceTag.tag_id)
            .where(ResourceTag.resource_type == self.resource_type, tag_filter)
        )
        return self.model.id.in_(linked)

    def all_folders(self) -> list[str]:
        """Every distinct stored folder in the collection (variant parents).

        One pass over the folder index - a few thousand values at most, however
        many items - cached for the request.
        """
        if self._all_folders is None:
            column = folder_column(self.model)
            rows = (
                self.db.query(column)
                .filter(variants.parent_filter(self.model), column.isnot(None))
                .distinct()
                .all()
            )
            self._all_folders = [f for (f,) in rows]
        return self._all_folders

    def in_folders(self, folders: list[str]) -> Any:
        """Rows directly in any of ``folders`` (stored folder values).

        Inlined as literals rather than bound: a broad tag can cover thousands
        of folders, past SQLite's bound-parameter limit. The parameter is
        anonymous (no key) so several of these in one query - a search plus a
        tag filter - stay distinct instead of one list overwriting the other.
        """
        if not folders:
            return false()
        param = bindparam(None, folders, expanding=True, literal_execute=True)
        return folder_column(self.model).in_(param)

    def _under(self, internals: set[str]) -> Any:
        """Rows at or below any folder carrying one of ``internals``.

        Resolved to the concrete folders beneath the tagged ones, in Python
        against :meth:`all_folders`, so the row test is one indexed ``IN``
        rather than a pair of range comparisons per tagged folder - which a
        negated filter ("no tags") evaluates on every row.
        """
        paths = outermost(
            [f.path for f in self.folders if any(normalize_internal(t) in internals for t in f.tags)]
        )
        if not paths:
            return false()
        prefixes = self.resolver.media_prefixes(self.resource_type)
        starts = tuple(p + path.strip("/") + "/" for p in prefixes for path in paths)
        return self.in_folders([f for f in self.all_folders() if f.startswith(starts)])

    def _any_tag(self) -> Any:
        """Rows carrying at least one tag, own or inherited."""
        linked = select(ResourceTag.resource_id).where(
            ResourceTag.resource_type == self.resource_type
        )
        clauses = [self.model.id.in_(linked)]
        if self.folders:
            every = {normalize_internal(t) for f in self.folders for t in f.tags}
            every.discard("")
            clauses.append(self._under(every))
        return or_(*clauses)

    def has(self, term: str) -> Any:
        """Rows carrying ``term`` exactly (a tag internal key, or a sentinel)."""
        if term == FILTER_ANY:
            return self._any_tag()
        if term == FILTER_NONE:
            return not_(self._any_tag())
        key = normalize_internal(term)
        if not key:
            return false()
        clause = self._direct(Tag.internal == key)
        if self.folders:
            clause = or_(clause, self._under({key}))
        return clause

    def like(self, text: str) -> Any:
        """Rows carrying a tag whose name contains ``text`` (the ``tag:`` search)."""
        like = f"%{text}%"
        clause = self._direct(or_(Tag.display.ilike(like), Tag.internal.ilike(like)))
        if self.folders:
            needle = text.lower()
            catalog = {
                t.internal
                for t in self.db.query(Tag.internal).filter(
                    or_(Tag.display.ilike(like), Tag.internal.ilike(like))
                )
            }
            raw = {
                normalize_internal(t)
                for f in self.folders
                for t in f.tags
                if needle in str(t).lower()
            }
            matched = (catalog | raw) - {""}
            if matched:
                clause = or_(clause, self._under(matched))
        return clause

    def clause(self, groups: list[dict]) -> Any:
        """The whole expression, or ``true()`` when it constrains nothing."""
        parts = []
        for group in groups:
            hit = or_(*[self.has(t) for t in group["tags"]])
            parts.append(not_(hit) if group["mode"] == GROUP_EXCLUDE else hit)
        return and_(*parts) if parts else true()
