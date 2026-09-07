"""Per-format capability table for 3D models.

The sibling of ``formats.py``, and built for the same reason: so that "can this
be viewed / thumbnailed?" is a question about *capability* rather than a
scattered comparison against a file extension. Adding a format is one row here
plus, if it needs one, a parser — not a hunt through the scanner, the router and
the frontend.

The distinctions that matter for 3D files are not the ones books have:

``mesh``
    Geometry the app can actually read. ``.stl`` is a bare triangle list, which
    is why it is the one format that thumbnails today (see ``stl_render.py``).
    ``.obj`` and ``.ply`` are meshes too, and the same rasteriser could serve
    them once a parser exists.

``container``
    An archive or scene format that *holds* geometry — ``.3mf`` is a zip,
    ``.glb`` a binary glTF. Readable in the browser, but each needs a real
    parser rather than the triangle loop, so none is thumbnailed server-side.

``sliced``
    Output from a resin slicer: a stack of per-layer images encoded for one
    specific printer. Not geometry at all. Registered so the file stays visible
    and downloadable next to the mesh it came from, and never viewable.

``viewer_loader`` is the contract with the frontend. The extension→loader
mapping lives here, on the backend, and is handed to the client in the detail
response, so the two cannot drift the way a hand-mirrored table does.
"""
from pathlib import Path
from typing import Dict, NamedTuple, Optional

# Ceiling on a mesh we will load into the browser viewer *automatically*. A
# binary STL is 50 bytes per triangle, so 256 MiB is roughly 5.4M triangles — a
# heavy load for a tab, but one a modern machine handles, and large multi-part
# terrain and high-detail scans genuinely reach this size.
#
# Deliberately larger than the *thumbnail* rasteriser's MAX_TRIANGLES: the viewer
# runs on the user's GPU, once, at their request, while a thumbnail is rendered
# in Python on the server for every file in the library during a scan. The two
# limits answer different questions and are not expected to agree.
VIEWER_SIZE_CAP = 256 * 1024 * 1024


class Model3DSpec(NamedTuple):
    """How one 3D file format is handled across the pipeline."""

    mime: str
    family: str  # "mesh" | "container" | "sliced"
    viewable: bool  # the browser viewer can render it
    thumbnailable: bool  # a server-side thumbnail can be produced
    loader: str  # frontend loader key, "" when not viewable


# Keyed by lowercased extension.
#
# Two formats are deliberately registered as *not* viewable despite being real
# geometry. ``.obj`` references a sibling ``.mtl`` (which references texture
# files) by name, and non-binary ``.gltf`` references an external ``.bin`` plus
# textures the same way — neither is a single self-contained file, so serving
# one to the viewer yields an untextured or broken result until sibling-file
# resolution exists. ``.glb`` is the self-contained spelling of glTF and is
# viewable now.
_FORMATS: Dict[str, Model3DSpec] = {
    # --- meshes ---
    ".stl": Model3DSpec("model/stl", "mesh", True, True, "stl"),
    ".ply": Model3DSpec("model/ply", "mesh", True, False, "ply"),
    ".obj": Model3DSpec("model/obj", "mesh", False, False, ""),
    # --- containers ---
    ".3mf": Model3DSpec("model/3mf", "container", True, False, "3mf"),
    ".glb": Model3DSpec("model/gltf-binary", "container", True, False, "gltf"),
    ".gltf": Model3DSpec("model/gltf+json", "container", False, False, ""),
    # --- sliced printer output ---
    ".lys": Model3DSpec("application/octet-stream", "sliced", False, False, ""),
    ".ctb": Model3DSpec("application/octet-stream", "sliced", False, False, ""),
    ".cbddlp": Model3DSpec("application/octet-stream", "sliced", False, False, ""),
    ".pwmx": Model3DSpec("application/octet-stream", "sliced", False, False, ""),
    ".photon": Model3DSpec("application/octet-stream", "sliced", False, False, ""),
}

MODEL_EXTS = frozenset(_FORMATS)
VIEWABLE_EXTS = frozenset(e for e, s in _FORMATS.items() if s.viewable)
THUMBNAILABLE_EXTS = frozenset(e for e, s in _FORMATS.items() if s.thumbnailable)
MESH_EXTS = frozenset(e for e, s in _FORMATS.items() if s.family == "mesh")
SLICED_EXTS = frozenset(e for e, s in _FORMATS.items() if s.family == "sliced")


def spec_for_ext(ext: str) -> Optional[Model3DSpec]:
    """The spec for a file extension, or None if it is not a model format."""
    return _FORMATS.get(ext.lower())


def spec_for_path(path: str) -> Optional[Model3DSpec]:
    """The spec for a filesystem path, or None if it is not a model format."""
    return spec_for_ext(Path(path).suffix)


def model_mime(path: str) -> str:
    """MIME type to serve a model file with.

    Falls back to ``application/octet-stream`` rather than guessing from the
    extension: a wrong ``model/*`` type invites the browser to try to render
    something it cannot, and a download is always a safe interpretation.
    """
    spec = spec_for_path(path)
    return spec.mime if spec else "application/octet-stream"


def is_viewable(path: str) -> bool:
    """True when the browser viewer can render this file."""
    spec = spec_for_path(path)
    return bool(spec and spec.viewable)


def can_thumbnail(path: str) -> bool:
    """True when a server-side thumbnail can be produced for this file."""
    spec = spec_for_path(path)
    return bool(spec and spec.thumbnailable)


def viewer_loader(path: str) -> str:
    """The frontend loader key for a file, or "" when it is not viewable."""
    spec = spec_for_path(path)
    return spec.loader if spec else ""


def viewer_available(path: str, file_size: Optional[int]) -> bool:
    """True when the browser viewer should load this file without being asked.

    Says no for two independent reasons — the format has no loader at all, or
    the mesh is past ``VIEWER_SIZE_CAP``. The two are not interchangeable to the
    client: an oversized mesh of a supported format can still be loaded on
    demand, which ``viewer_oversized`` is what distinguishes.
    """
    if not is_viewable(path):
        return False
    return not (file_size and file_size > VIEWER_SIZE_CAP)


def viewer_oversized(path: str, file_size: Optional[int]) -> bool:
    """True when only the size cap stands between this file and the viewer.

    The detail view offers these behind an explicit confirmation rather than a
    download-only panel: the mesh *can* render, it may just be slow or exhaust
    the tab, and that is the user's call to make once they are warned. A format
    with no loader is never oversized — no amount of consent will render it.
    """
    if not is_viewable(path):
        return False
    return bool(file_size and file_size > VIEWER_SIZE_CAP)
