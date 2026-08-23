"""Turning pairwise edges into the groups a user reviews.

Detection produces *edges* - "these two look alike, for this reason, this
strongly". A user thinks in *groups*: the three copies of one book, together,
with one action to take. Union-find is what bridges them, and it also handles the
transitive case the signals cannot see on their own (A matches B by hash, B
matches C by title, so all three belong on one screen).
"""
import hashlib
from dataclasses import dataclass, field
from typing import Iterable, Optional

# A blocking collision can chain a long run of unrelated files into one giant
# component. Past this size a "group" is noise rather than a finding, so it is
# split rather than shown; the strongest edges survive the split.
MAX_GROUP_SIZE = 12


@dataclass
class Edge:
    """One pairwise finding."""

    a: str
    b: str
    reason: str  # hash | metadata | text | grid
    score: float

    @property
    def pair(self) -> frozenset:
        return frozenset((self.a, self.b))


@dataclass
class Group:
    """A cluster of look-alikes, as reviewed."""

    member_ids: list[str]
    confidence: float
    reasons: list[str] = field(default_factory=list)
    # The pairwise matches behind this cluster. Carried through so review can
    # show the comparisons that actually fired rather than inventing pairs from
    # the transitive closure — see the note on DuplicateGroup.edges.
    edges: list = field(default_factory=list)

    @property
    def key(self) -> str:
        return group_key(self.member_ids)


def group_key(member_ids: Iterable[str]) -> str:
    """A stable identity for a set of members, independent of order.

    Keyed on ids rather than on titles or hashes so a group keeps its identity -
    and therefore its dismissal - when the user edits the metadata or the files
    get re-hashed.
    """
    joined = " ".join(sorted(member_ids))
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()


class _UnionFind:
    def __init__(self) -> None:
        self._parent: dict[str, str] = {}

    def find(self, item: str) -> str:
        self._parent.setdefault(item, item)
        root = item
        while self._parent[root] != root:
            root = self._parent[root]
        # Path compression, so repeated lookups over a long chain stay cheap.
        while self._parent[item] != root:
            self._parent[item], item = root, self._parent[item]
        return root

    def union(self, a: str, b: str) -> None:
        root_a, root_b = self.find(a), self.find(b)
        if root_a != root_b:
            self._parent[root_b] = root_a


def build_groups(
    edges: Iterable[Edge], dismissed_pairs: Optional[set] = None
) -> list[Group]:
    """Cluster edges into reviewable groups.

    ``dismissed_pairs`` is applied here, at the *edge* level rather than to
    finished groups. That is deliberate: a user who dismissed {A,B} should stop
    seeing that relationship even when a later scan finds a third copy C, while C
    itself still surfaces against both. Filtering whole groups by key would fail
    both halves of that.
    """
    rejected = dismissed_pairs or set()
    live = [e for e in edges if e.pair not in rejected]
    if not live:
        return []

    uf = _UnionFind()
    for edge in live:
        uf.union(edge.a, edge.b)

    members: dict[str, set] = {}
    edges_by_root: dict[str, list] = {}
    for edge in live:
        root = uf.find(edge.a)
        members.setdefault(root, set()).update((edge.a, edge.b))
        edges_by_root.setdefault(root, []).append(edge)

    groups = []
    for root, ids in members.items():
        group_edges = edges_by_root[root]
        if len(ids) > MAX_GROUP_SIZE:
            groups.extend(_split_oversized(group_edges))
            continue
        groups.append(
            Group(
                member_ids=sorted(ids),
                confidence=max(e.score for e in group_edges),
                reasons=sorted({e.reason for e in group_edges}),
                edges=list(group_edges),
            )
        )
    # Strongest first: the byte-identical pairs a user can action instantly
    # should not be buried under a page of fuzzy title matches.
    groups.sort(key=lambda g: (-g.confidence, g.member_ids))
    return groups


def _split_oversized(edges: list) -> list[Group]:
    """Break a runaway component into its strongest pairs.

    A component this large almost always came from a blocking collision - a
    dozen supplements sharing a series title - rather than from a dozen copies of
    one file. Rather than show a group nobody can act on, keep only the pairs
    that stand on their own.
    """
    ranked = sorted(edges, key=lambda e: -e.score)[:MAX_GROUP_SIZE]
    return [
        Group(
            member_ids=sorted((e.a, e.b)),
            confidence=e.score,
            reasons=[e.reason],
            edges=[e],
        )
        for e in ranked
    ]
