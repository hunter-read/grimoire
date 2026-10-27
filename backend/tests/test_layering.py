"""Structural guard: HTTP routers sit on top of the domain code, never under it.

Code outside ``backend/routers/`` must not import a router, so the indexer, the
render pool, services, the scheduler and the library watcher never depend on
HTTP handlers. And a router package must not reach into another package's
private (``_``-prefixed) modules or names: logic two routers share belongs in
``backend/services/`` (or another domain package), or in a top-level
``backend/routers/_*.py`` module when it is genuinely HTTP-only.

Two importers are expected: ``backend/main.py`` mounts the routers, and the MCP
server's tools call the REST handlers by design (see ``mcp_server/tools/_base.py``).
"""
import ast
import pathlib

BACKEND = pathlib.Path(__file__).resolve().parents[1]

# Allowed to import routers: main.py mounts them, MCP tools call their handlers.
_ROUTER_IMPORTERS = {"main.py", "mcp_server"}


def _module_parts(path: pathlib.Path) -> list[str]:
    """``backend/routers/books/core.py`` -> ``['backend', 'routers', 'books', 'core']``."""
    parts = list(path.relative_to(BACKEND.parent).with_suffix("").parts)
    return parts[:-1] if parts[-1] == "__init__" else parts


def _imports(path: pathlib.Path):
    """Yield (line, imported module parts, imported names) for each import in ``path``."""
    package = _module_parts(path)
    if path.name != "__init__.py":
        package = package[:-1]
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                yield node.lineno, alias.name.split("."), []
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                base = package[: len(package) - (node.level - 1)]
                module = base + (node.module.split(".") if node.module else [])
            else:
                module = (node.module or "").split(".")
            yield node.lineno, module, [alias.name for alias in node.names]


def _sources():
    for path in sorted(BACKEND.rglob("*.py")):
        rel = path.relative_to(BACKEND)
        if rel.parts[0] == "tests" or "__pycache__" in rel.parts:
            continue
        yield rel, path


def _router_package(module: list[str]) -> str | None:
    """The router package an imported module is in, or None for ``routers/_*.py`` and outsiders."""
    if module[:2] != ["backend", "routers"] or len(module) < 3 or module[2].startswith("_"):
        return None
    return module[2]


def test_only_main_and_mcp_import_routers():
    offenders = []
    for rel, path in _sources():
        if rel.parts[0] == "routers" or rel.parts[0] in _ROUTER_IMPORTERS:
            continue
        for line, module, names in _imports(path):
            targets = [module] + [module + [name] for name in names]
            if any(t[:2] == ["backend", "routers"] for t in targets):
                offenders.append(f"{rel.as_posix()}:{line} imports {'.'.join(module)}")
    assert not offenders, (
        "Only main.py and the MCP server may import backend.routers. Move what these "
        f"need into backend/services/ (or another domain package): {offenders}"
    )


def test_main_imports_only_router_packages():
    """main.py mounts routers; anything else it needs lives outside them."""
    offenders = []
    for line, module, names in _imports(BACKEND / "main.py"):
        if module[:2] != ["backend", "routers"]:
            continue
        if len(module) > 3 or any(n.startswith("_") for n in names):
            offenders.append(f"main.py:{line} imports {'.'.join(module)} {names}")
    assert not offenders, offenders


def test_routers_do_not_reach_into_other_routers_private_code():
    offenders = []
    for rel, path in _sources():
        if rel.parts[0] != "routers":
            continue
        # routers/<package>/..., or None for a top-level routers/_*.py module.
        own = rel.parts[1] if len(rel.parts) > 2 else None
        for line, module, names in _imports(path):
            other = _router_package(module)
            if other is None or other == own:
                continue
            private_module = any(p.startswith("_") for p in module[3:])
            private_names = [n for n in names if n.startswith("_")]
            if private_module or private_names:
                what = ".".join(module) + (f" ({', '.join(private_names)})" if private_names else "")
                offenders.append(f"{rel.as_posix()}:{line} imports {what}")
    assert not offenders, (
        "Router packages must not import another router package's private modules or "
        "names. Move the shared code into backend/services/, or into a top-level "
        f"backend/routers/_*.py module if it is HTTP-only: {offenders}"
    )


def _exists(module: list[str]) -> bool:
    path = BACKEND.parent.joinpath(*module)
    return path.with_suffix(".py").is_file() or (path / "__init__.py").is_file()


def test_backend_imports_resolve():
    """Every import into ``backend`` names a module that exists.

    A function-level import is only run when its branch is, so one left pointing
    at a module's old home after a move can hide until that branch is hit.
    """
    missing = []
    for rel, path in _sources():
        for line, module, _names in _imports(path):
            if module[:1] == ["backend"] and not _exists(module):
                missing.append(f"{rel.as_posix()}:{line} imports {'.'.join(module)}")
    assert not missing, missing


def test_the_scanner_sees_imports():
    """Guards the test itself: a walk that resolved nothing would pass vacuously."""
    seen = set()
    for _, path in _sources():
        for _, module, _ in _imports(path):
            seen.add(".".join(module[:3]))
    assert "backend.routers.books" in seen
    assert "backend.services.access_control" in seen
