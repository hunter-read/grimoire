"""``.grimoireignore`` support for the library scanner (issue #224).

A ``.grimoireignore`` file uses the same syntax as ``.gitignore`` /
``.dockerignore`` (git's *gitignore* dialect): one pattern per line, blank
lines and ``#`` comments ignored, ``!`` negation to re-include, ``/`` to anchor
or mark a directory, and ``**`` for arbitrary-depth matching.

Files and directories matched by an ignore rule are skipped by the scanner, so
they never appear in the library UI.  Rules are **cumulative and nested** like
git: a ``.grimoireignore`` at the library root applies everywhere, and one in a
subfolder adds rules for its own subtree.  Each file's patterns are matched
relative to the directory that file lives in.

The public entry point is :class:`IgnoreMatcher`, built once per scan from the
library root and queried per path with :meth:`IgnoreMatcher.is_ignored`.
"""

import logging
import os
from pathlib import Path
from typing import Optional

from pathspec import PathSpec

logger = logging.getLogger("grimoire.indexer")

# Name of the per-directory ignore file, mirroring ``.gitignore``.
IGNORE_FILENAME = ".grimoireignore"


class IgnoreMatcher:
    """Resolves ``.grimoireignore`` rules for paths under a library root.

    Ignore files are loaded lazily and cached per directory, so a full scan
    reads each ``.grimoireignore`` at most once.  Matching walks from the
    library root down to the path's own directory, applying each directory's
    patterns relative to that directory (git semantics), with deeper and
    later rules overriding shallower ones — including ``!`` re-inclusion.
    """

    def __init__(self, library_root: str) -> None:
        # Resolve so ancestor computation is stable regardless of how callers
        # spell the root (trailing slash, symlinks in the walked paths, …).
        self._root = Path(library_root).resolve()
        # dir (resolved) -> compiled PathSpec, or None when that dir has no
        # ignore file.  None is cached too, so a missing file is stat'd once.
        self._cache: dict[Path, Optional[PathSpec]] = {}
        # parent dir as the caller spelled it -> (resolved dir, the rules that
        # apply under it, shallowest first). See ``_rules_for``.
        self._rules: dict[str, tuple[Path, list[tuple[Path, PathSpec]]]] = {}

    def _spec_for_dir(self, directory: Path) -> Optional[PathSpec]:
        """Load and cache the PathSpec for a single directory's ignore file."""
        if directory in self._cache:
            return self._cache[directory]
        spec: Optional[PathSpec] = None
        ignore_file = directory / IGNORE_FILENAME
        try:
            if ignore_file.is_file():
                lines = ignore_file.read_text(encoding="utf-8").splitlines()
                spec = PathSpec.from_lines("gitignore", lines)
        except OSError as exc:
            logger.warning(f"Could not read {ignore_file}: {exc}")
        self._cache[directory] = spec
        return spec

    def _ancestors(self, directory: Path) -> list[Path]:
        """Return [root, …, directory], shallowest first, or [] if outside root.

        ``directory`` must already be resolved, as the root is.
        """
        if directory != self._root and self._root not in directory.parents:
            return []
        chain = [directory]
        while chain[-1] != self._root:
            chain.append(chain[-1].parent)
        chain.reverse()
        return chain

    def _rules_for(self, directory: str) -> tuple[Path, list[tuple[Path, PathSpec]]]:
        """``directory`` resolved, and each ancestor's ignore rules, cached.

        Resolving a path stats every component of it, so doing it per file cost
        the missing-file sweep 15-20 ``lstat`` calls a record - half an hour a
        pass over a large library on a Docker Desktop bind mount, even with no
        ignore file anywhere (issue #748). Files share directories, so each
        directory is resolved once, and a file under no rules needs no stat.
        """
        cached = self._rules.get(directory)
        if cached is None:
            try:
                resolved = Path(directory).resolve()
            except OSError:
                resolved = Path(directory)
            rules = []
            for ancestor in self._ancestors(resolved):
                spec = self._spec_for_dir(ancestor)
                if spec is not None:
                    rules.append((ancestor, spec))
            cached = self._rules[directory] = (resolved, rules)
        return cached

    def is_ignored(self, path: str, is_dir: bool) -> bool:
        """Return True if `path` is excluded by any applicable ignore rule.

        `path` is an absolute filesystem path.  `is_dir` must be True for
        directories so that directory-only patterns (``foo/``) match correctly.
        Deeper directories' rules are evaluated after shallower ones, so a
        nested ``.grimoireignore`` can override (including re-include via ``!``)
        what an ancestor ignored; the last matching rule wins, as in git.
        """
        # The parent is resolved so the path is spelled the same way as the
        # ancestor chain (which is derived from the resolved library root);
        # otherwise a symlink in the root (e.g. macOS ``/var`` -> ``/private/var``)
        # makes relpath produce a bogus ``../..`` prefix that never matches.
        # resolve() is non-strict, so it works even for the removed-file
        # reconciliation case where the path no longer exists on disk.
        parent, name = os.path.split(path.rstrip(os.sep) or path)
        resolved_parent, rules = self._rules_for(parent)
        if not rules:
            return False
        p = resolved_parent / name
        result = False
        for ancestor, spec in rules:
            # Patterns in `ancestor`'s ignore file are relative to `ancestor`.
            rel = os.path.relpath(str(p), str(ancestor)).replace(os.sep, "/")
            if is_dir:
                rel += "/"
            match = spec.check_file(rel)
            if match.include is not None:
                result = match.include
        return result
