#!/usr/bin/env python3
"""Per-changed-file backend coverage gate.

Mirrors frontend/scripts/check-coverage.mjs: fails if any changed backend source
file (backend/**.py, excluding tests) has line coverage below MIN_PCT. This
enforces the "each change brings coverage up" goal without imposing a hard global
threshold.

Strict by design: a changed source file absent from the coverage report (i.e. no
test exercises it at all) is treated as 0% and fails.

Reads coverage.json (coverage.py's JSON report) from the repo root — run
``pytest --cov=backend --cov-report=json`` first.

Base ref for the diff comes from $BASE_REF (CI sets this), falling back to
origin/dev, then dev. Override the threshold with $MIN_COVERAGE.
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

MIN_PCT = float(os.environ.get("MIN_COVERAGE", "80"))


def git(args, cwd=None):
    return subprocess.run(
        ["git", *args], capture_output=True, text=True, cwd=cwd, check=True
    ).stdout.strip()


def git_lines(args, cwd=None):
    try:
        out = git(args, cwd=cwd)
    except subprocess.CalledProcessError:
        return []
    return out.split("\n") if out else []


def repo_root():
    return git(["rev-parse", "--show-toplevel"])


def resolve_base(root):
    candidates = [c for c in (os.environ.get("BASE_REF"), "origin/dev", "dev") if c]
    for ref in candidates:
        try:
            git(["rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}"], cwd=root)
            return ref
        except subprocess.CalledProcessError:
            continue
    return None


_TEST_RE = re.compile(r"(^|/)(test_[^/]+|conftest)\.py$")


def changed_source_files(base, root):
    """Backend .py files changed vs base, excluding tests/conftest/scripts.

    Unions three changesets so it works in CI and locally before committing:
      1. committed changes the branch introduces (base...HEAD, PR semantics),
      2. uncommitted tracked changes (git diff HEAD),
      3. untracked new files.
    Returns paths relative to the repo root (matching coverage.json keys).
    """
    files = set()
    files.update(
        git_lines(
            ["diff", "--name-only", "--diff-filter=ACMR", f"{base}...HEAD", "--", "backend"],
            cwd=root,
        )
    )
    files.update(
        git_lines(["diff", "--name-only", "--diff-filter=ACMR", "HEAD", "--", "backend"], cwd=root)
    )
    files.update(git_lines(["ls-files", "--others", "--exclude-standard", "--", "backend"], cwd=root))

    result = []
    for p in files:
        p = p.strip()
        if not p or not p.endswith(".py"):
            continue
        if "/tests/" in p or _TEST_RE.search(p):
            continue
        if p.startswith("backend/scripts/"):
            continue
        result.append(p)
    return sorted(result)


def lookup(summary_files, rel):
    for key in (rel, f"./{rel}"):
        if key in summary_files:
            return summary_files[key]
    return None


def main():
    root = repo_root()
    base = resolve_base(root)
    if not base:
        print("⚠ check-coverage: no base ref resolvable; skipping gate.")
        return 0

    changed = changed_source_files(base, root)
    if not changed:
        print(f"✓ check-coverage: no changed backend source files vs {base}.")
        return 0

    report_path = Path(root) / "coverage.json"
    if not report_path.exists():
        print(
            f"✗ check-coverage: {report_path} not found. "
            'Run "pytest --cov=backend --cov-report=json" first.',
            file=sys.stderr,
        )
        return 1

    files = json.loads(report_path.read_text())["files"]

    failures = []
    passes = []
    for rel in changed:
        entry = lookup(files, rel)
        pct = entry["summary"]["percent_covered"] if entry else 0.0
        if pct < MIN_PCT:
            failures.append((rel, pct, entry is None))
        else:
            passes.append((rel, pct))

    for rel, pct in passes:
        print(f"✓ {pct:6.2f}%  {rel}")
    for rel, pct, untested in failures:
        note = " (no coverage — needs tests)" if untested else ""
        print(f"✗ {pct:6.2f}%  {rel}{note}", file=sys.stderr)

    if failures:
        print(
            f"\n✗ check-coverage: {len(failures)} changed file(s) below "
            f"{MIN_PCT:.0f}% line coverage.",
            file=sys.stderr,
        )
        return 1

    print(f"\n✓ check-coverage: all {len(passes)} changed file(s) ≥ {MIN_PCT:.0f}%.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
