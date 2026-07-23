"""Unit tests for the ``.grimoireignore`` matcher (issue #224).

These exercise :class:`IgnoreMatcher` directly, without touching the scanner or
the database, covering gitwildmatch semantics: globs, directory-only patterns,
anchoring, ``**`` depth, cumulative nested files, and ``!`` re-inclusion.
"""
import tempfile
from pathlib import Path

from backend.library_ignore import IGNORE_FILENAME, IgnoreMatcher


def _mk_root() -> Path:
    root = Path(tempfile.mkdtemp()) / "library"
    root.mkdir()
    return root


def _write_ignore(directory: Path, *lines: str) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / IGNORE_FILENAME).write_text("\n".join(lines) + "\n", encoding="utf-8")


class TestNoIgnoreFile:
    def test_nothing_ignored_without_file(self):
        root = _mk_root()
        m = IgnoreMatcher(str(root))
        assert m.is_ignored(str(root / "books" / "a.pdf"), is_dir=False) is False

    def test_path_outside_root_is_not_ignored(self):
        root = _mk_root()
        _write_ignore(root, "*.pdf")
        m = IgnoreMatcher(str(root))
        # A sibling of the library root is never governed by its ignore file.
        outside = root.parent / "elsewhere" / "a.pdf"
        assert m.is_ignored(str(outside), is_dir=False) is False


class TestGlobPatterns:
    def test_wildcard_matches_at_any_depth(self):
        root = _mk_root()
        _write_ignore(root, "*BW Single Pages*.pdf")
        m = IgnoreMatcher(str(root))
        deep = root / "books" / "Sys" / "core" / "Players BW Single Pages.pdf"
        assert m.is_ignored(str(deep), is_dir=False) is True
        keep = root / "books" / "Sys" / "core" / "Players Handbook.pdf"
        assert m.is_ignored(str(keep), is_dir=False) is False

    def test_extension_glob(self):
        root = _mk_root()
        _write_ignore(root, "*.tmp")
        m = IgnoreMatcher(str(root))
        assert m.is_ignored(str(root / "a" / "b.tmp"), is_dir=False) is True
        assert m.is_ignored(str(root / "a" / "b.pdf"), is_dir=False) is False


class TestDirectoryPatterns:
    def test_directory_only_pattern_matches_dir(self):
        root = _mk_root()
        _write_ignore(root, "ignore/")
        m = IgnoreMatcher(str(root))
        d = root / "books" / "Sys" / "ignore"
        assert m.is_ignored(str(d), is_dir=True) is True

    def test_directory_pattern_matches_contained_file(self):
        root = _mk_root()
        _write_ignore(root, "ignore/")
        m = IgnoreMatcher(str(root))
        f = root / "books" / "Sys" / "ignore" / "variant.pdf"
        assert m.is_ignored(str(f), is_dir=False) is True

    def test_directory_only_pattern_does_not_match_file_of_same_name(self):
        root = _mk_root()
        _write_ignore(root, "ignore/")
        m = IgnoreMatcher(str(root))
        # A *file* literally named "ignore" is not a directory match.
        f = root / "books" / "ignore"
        assert m.is_ignored(str(f), is_dir=False) is False


class TestAnchoringAndDepth:
    def test_anchored_pattern_matches_only_at_root(self):
        root = _mk_root()
        _write_ignore(root, "/drafts")
        m = IgnoreMatcher(str(root))
        assert m.is_ignored(str(root / "drafts"), is_dir=True) is True
        # A nested "drafts" is not anchored at the root, so it is kept.
        assert m.is_ignored(str(root / "books" / "drafts"), is_dir=True) is False

    def test_globstar_matches_across_directories(self):
        root = _mk_root()
        _write_ignore(root, "books/**/scratch/**")
        m = IgnoreMatcher(str(root))
        f = root / "books" / "Sys" / "deep" / "scratch" / "x.pdf"
        assert m.is_ignored(str(f), is_dir=False) is True


class TestNestedCumulative:
    def test_nested_file_adds_rules_for_subtree(self):
        root = _mk_root()
        sub = root / "books" / "Sys"
        _write_ignore(sub, "*.bak")
        m = IgnoreMatcher(str(root))
        # Governed by the nested file.
        assert m.is_ignored(str(sub / "core" / "a.bak"), is_dir=False) is True
        # A sibling subtree without that nested file is unaffected.
        assert m.is_ignored(str(root / "books" / "Other" / "a.bak"), is_dir=False) is False

    def test_nested_negation_reincludes_ancestor_ignored_file(self):
        root = _mk_root()
        _write_ignore(root, "*.pdf")
        sub = root / "books" / "Sys"
        _write_ignore(sub, "!keep.pdf")
        m = IgnoreMatcher(str(root))
        # Ancestor ignores all PDFs …
        assert m.is_ignored(str(root / "books" / "other.pdf"), is_dir=False) is True
        # … but the nested file re-includes this one.
        assert m.is_ignored(str(sub / "keep.pdf"), is_dir=False) is False


class TestComments:
    def test_comments_and_blank_lines_ignored(self):
        root = _mk_root()
        _write_ignore(root, "# a comment", "", "*.pdf")
        m = IgnoreMatcher(str(root))
        assert m.is_ignored(str(root / "a.pdf"), is_dir=False) is True


class TestCaching:
    def test_spec_cached_after_file_removed(self):
        """The matcher reads each ignore file once; later removal doesn't re-stat."""
        root = _mk_root()
        _write_ignore(root, "*.pdf")
        m = IgnoreMatcher(str(root))
        assert m.is_ignored(str(root / "a.pdf"), is_dir=False) is True
        (root / IGNORE_FILENAME).unlink()
        # Cached spec still applies — a single scan sees a consistent rule set.
        assert m.is_ignored(str(root / "b.pdf"), is_dir=False) is True
