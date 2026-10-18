#!/usr/bin/env python3
"""Start a built Grimoire image and check that it actually works (issue #582).

The unit tests import the code from a virtualenv, so nothing in them notices an
image that fails to build, fails to start, or is missing a runtime dependency
that only exists inside it (unar, tesseract, the decode-only ffmpeg). CI runs
this against every build of both image targets:

    python3 backend/scripts/smoke_test_image.py IMAGE --target slim|ocr

It generates a tiny library (a PDF with a searchable sentence, a CBR comic, an
image map) with the standard library alone, starts the image on it with an
empty data folder, and checks, through the HTTP API: the container comes up
healthy as a non-root user, first-run setup works, the scan indexes all three,
the PDF is searchable and its page renders, the CBR gets a cover thumbnail
(which needs unar), and the map gets one (Pillow). Then the tools the image
bundles: ffmpeg runs, and tesseract does in the OCR image and is absent in
slim. On failure it prints the container's log.

Standard library only, so it runs on a bare CI runner. Exits non-zero on the
first failed check.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib
from collections.abc import Callable

# A sentence that appears nowhere else, so a search hit can only be the fixture.
PHRASE = "quixotic basilisk lantern"
SYSTEM = "Smoke System"
ADMIN = {"username": "smoke-admin", "password": "smoke-test-password-1"}


# ---------------------------------------------------------------------------
# Fixtures, built from nothing
# ---------------------------------------------------------------------------


def make_pdf(text: str) -> bytes:
    """A one-page PDF whose text layer holds ``text``."""
    stream = f"BT /F1 24 Tf 72 720 Td ({text}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % offset for offset in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        len(objects) + 1,
        xref,
    )
    return bytes(out)


def make_png(width: int, height: int, rgb: tuple[int, int, int]) -> bytes:
    """A solid-colour RGB PNG."""

    def chunk(kind: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + kind
            + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    row = b"\x00" + bytes(rgb) * width
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(row * height))
        + chunk(b"IEND", b"")
    )


def make_rar(files: dict[str, bytes]) -> bytes:
    """A RAR 4 archive holding ``files`` uncompressed ("store" method).

    RAR can't be written with any standard tool, but the stored form is simple:
    a marker, an archive header, a header plus the raw bytes per file, and an
    end block. Each header carries the low 16 bits of the CRC-32 of its own
    bytes after the CRC field.
    """

    def block(head_type: int, flags: int, body: bytes) -> bytes:
        rest = struct.pack("<BHH", head_type, flags, 7 + len(body)) + body
        return struct.pack("<H", zlib.crc32(rest) & 0xFFFF) + rest

    out = bytearray(b"Rar!\x1a\x07\x00")
    out += block(0x73, 0, struct.pack("<HI", 0, 0))  # archive header
    dos_time = (2026 - 1980) << 25 | 1 << 21 | 1 << 16  # 2026-01-01 00:00
    for name, data in files.items():
        encoded = name.encode()
        header = struct.pack(
            "<IIBIIBBHI",
            len(data),  # packed size
            len(data),  # unpacked size
            0,  # host OS: MS-DOS
            zlib.crc32(data) & 0xFFFFFFFF,
            dos_time,
            20,  # version needed to extract: 2.0
            0x30,  # method: store
            len(encoded),
            0x20,  # attributes: archive
        )
        out += block(0x74, 0x8000, header + encoded) + data
    out += block(0x7B, 0x4000, b"")  # end of archive
    return bytes(out)


def build_library(root: str) -> None:
    core = os.path.join(root, "books", SYSTEM, "core")
    os.makedirs(core)
    with open(os.path.join(core, "Smoke Rulebook.pdf"), "wb") as fh:
        fh.write(make_pdf(f"The {PHRASE} is lit."))
    with open(os.path.join(core, "Smoke Comic.cbr"), "wb") as fh:
        fh.write(make_rar({"page01.png": make_png(64, 96, (200, 40, 40))}))
    maps = os.path.join(root, "maps", "Smoke Maps")
    os.makedirs(maps)
    with open(os.path.join(maps, "Smoke Cave.png"), "wb") as fh:
        fh.write(make_png(128, 96, (40, 120, 200)))


# ---------------------------------------------------------------------------
# Talking to the container
# ---------------------------------------------------------------------------


class SmokeFailure(Exception):
    pass


def check(condition: object, message: str) -> None:
    if not condition:
        raise SmokeFailure(message)
    print(f"  ok  {message}")


def docker(*args: str, capture: bool = True) -> str:
    result = subprocess.run(
        ["docker", *args], capture_output=capture, text=True, check=False
    )
    if result.returncode != 0:
        output = (result.stderr or result.stdout or "").strip()
        raise SmokeFailure(f"docker {' '.join(args)} failed: {output}")
    return result.stdout.strip() if capture else ""


class Api:
    def __init__(self, base: str) -> None:
        self.base = base
        self.token: str | None = None

    def request(self, method: str, path: str, body: object = None) -> tuple[int, bytes, str]:
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.status, resp.read(), resp.headers.get("Content-Type", "")
        except urllib.error.HTTPError as e:
            return e.code, e.read(), e.headers.get("Content-Type", "")

    def json(self, method: str, path: str, body: object = None) -> object:
        status, data, _ = self.request(method, path, body)
        if status != 200:
            raise SmokeFailure(f"{method} {path} -> {status}: {data[:300]!r}")
        return json.loads(data)


def wait_for(description: str, probe, timeout: float, interval: float = 1.0) -> object:
    """Call ``probe`` until it returns something truthy, or fail after ``timeout``."""
    deadline = time.monotonic() + timeout
    last: object = None
    while time.monotonic() < deadline:
        try:
            last = probe()
        except (urllib.error.URLError, ConnectionError, OSError, SmokeFailure) as e:
            last = e
        else:
            if last:
                return last
        time.sleep(interval)
    raise SmokeFailure(f"timed out after {timeout:.0f}s waiting for {description} (last: {last!r})")


def items(payload: object) -> list:
    """The rows of a list endpoint, whether it returns a list or a paged object."""
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("items", "books", "maps", "results"):
            if isinstance(payload.get(key), list):
                return payload[key]
    raise SmokeFailure(f"unexpected list response: {str(payload)[:200]}")


# ---------------------------------------------------------------------------
# The checks
# ---------------------------------------------------------------------------


def wait_healthy(container: str) -> str:
    """Wait for the container's HEALTHCHECK, then return the uid Grimoire runs as."""
    status = wait_for(
        "the health check",
        lambda: docker("inspect", "-f", "{{.State.Health.Status}}", container) == "healthy",
        timeout=180,
        interval=2,
    )
    check(status, "reports healthy")
    uid = docker("exec", container, "stat", "-c", "%u", "/proc/1")
    check(uid != "0", f"runs Grimoire as a non-root user (uid {uid})")
    return uid


def run_checks(api: Api, container: str, target: str) -> None:
    print("Container")
    wait_healthy(container)

    print("First run")
    setup = api.json("POST", "/api/auth/setup", ADMIN)
    api.token = setup["token"]
    check(api.token, "first-run setup creates the admin and signs in")

    print("Scan")

    def scanned() -> list | None:
        state = api.json("GET", "/api/scan-status")
        if state.get("running"):
            return None
        rows = items(api.json("GET", "/api/books?limit=500"))
        titles = {row.get("title") for row in rows}
        return rows if {"Smoke Rulebook", "Smoke Comic"} <= titles else None

    books = {row["title"]: row for row in wait_for("the scan to index the books", scanned, 180, 2)}
    check(True, "the start-up scan indexed the PDF and the CBR")
    pdf, cbr = books["Smoke Rulebook"], books["Smoke Comic"]

    # Text indexing can trail the scan's book rows by a moment.
    query = "/api/search?q=" + urllib.parse.quote(PHRASE.split()[1])
    check(
        wait_for("the PDF's text in search", lambda: pdf["id"] in json.dumps(api.json("GET", query)), 60),
        "full-text search finds the PDF by a word in its text layer",
    )

    status, body, kind = api.request("GET", f"/api/books/{pdf['id']}/page/1?width=400")
    check(status == 200 and kind.startswith("image/") and len(body) > 100, "a PDF page renders")

    def thumbnail(path: str):
        def probe():
            status, body, kind = api.request("GET", path)
            return status == 200 and kind.startswith("image/") and len(body) > 50
        return probe

    check(
        wait_for("the CBR cover", thumbnail(f"/api/books/{cbr['id']}/thumbnail"), 60),
        "the CBR gets a cover thumbnail",
    )
    check(
        wait_for("the PDF cover", thumbnail(f"/api/books/{pdf['id']}/thumbnail"), 60),
        "the PDF gets a cover thumbnail",
    )

    maps = items(api.json("GET", "/api/maps?limit=100"))
    cave = next((m for m in maps if "Smoke Cave" in json.dumps(m)), None)
    check(cave, "the scan indexed the image map")
    check(
        wait_for("the map thumbnail", thumbnail(f"/api/maps/{cave['id']}/thumbnail"), 60),
        "the map gets a thumbnail",
    )

    print("Bundled tools")
    # The fixture is a stored (uncompressed) RAR, which rarfile reads in pure
    # Python, so the thumbnail above doesn't prove unar works. Real CBRs are
    # compressed and need it, so run it directly, and check rarfile finds it.
    comic = f"/library/books/{SYSTEM}/core/Smoke Comic.cbr"
    docker("exec", container, "unar", "-q", "-f", "-o", "/tmp/smoke-unar", comic)
    check(
        "page01.png" in docker("exec", container, "ls", "/tmp/smoke-unar"),
        "unar extracts a CBR",
    )
    docker("exec", container, "python", "-c", "import rarfile; rarfile.tool_setup()")
    check(True, "rarfile finds an extraction tool for compressed RARs")
    check(
        "ffmpeg version" in docker("exec", container, "/usr/local/bin/ffmpeg", "-hide_banner", "-version"),
        "the decode-only ffmpeg runs",
    )
    tesseract = subprocess.run(
        ["docker", "exec", container, "tesseract", "--version"], capture_output=True, text=True
    )
    if target == "ocr":
        check(tesseract.returncode == 0, "tesseract runs (OCR image)")
        langs = docker("exec", container, "tesseract", "--list-langs")
        check("eng" in langs.split(), "tesseract has English data")
    else:
        check(tesseract.returncode != 0, "tesseract is absent (slim image)")


def check_upgrade(api: Api, container: str, start: Callable[[], str], image: str, data: str) -> None:
    """An install upgraded from the root-run image has a root-owned /data.

    Make it so, start a fresh container on the same volumes, and check the
    entrypoint hands the data over: Grimoire comes up non-root and can still
    write its database (signing in records a session).
    """
    print("Upgrade from a root-owned /data")
    docker("rm", "-f", container)
    docker("run", "--rm", "--entrypoint", "chown", "-v", f"{data}:/data", image, "-R", "0:0", "/data")
    start()
    uid = wait_healthy(container)
    owner = docker("exec", container, "stat", "-c", "%u", "/data/grimoire.db")
    check(owner == uid, "the root-owned database was handed to Grimoire's user")
    api.token = None
    login = api.json("POST", "/api/auth/login", ADMIN)
    check(login.get("token"), "signing in still works, so the database is writable")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("image", help="the image to test, e.g. grimoire:ci-slim")
    parser.add_argument("--target", choices=("slim", "ocr"), required=True)
    parser.add_argument("--port", type=int, default=19481)
    args = parser.parse_args()

    work = tempfile.mkdtemp(prefix="grimoire-smoke-")
    library = os.path.join(work, "library")
    build_library(library)
    container = f"grimoire-smoke-{os.getpid()}"
    # A named volume rather than a host folder: Docker Desktop reports every
    # bind-mounted file as root-owned, which would hide what the upgrade check
    # looks for. A named volume shows real ownership everywhere.
    data = f"{container}-data"
    docker("volume", "create", data)

    def start() -> str:
        subprocess.run(["docker", "rm", "-f", container], capture_output=True, check=False)
        print(f"Starting {args.image} ({args.target}) as {container}")
        docker(
            "run", "-d", "--name", container,
            "-p", f"127.0.0.1:{args.port}:9481",
            "-v", f"{library}:/library",
            "-v", f"{data}:/data",
            "-e", "LIBRARY_PATH=/library",
            "-e", "DATA_PATH=/data",
            "-e", "DISABLE_VERSION_CHECKING=true",
            args.image,
        )
        return container

    api = Api(f"http://127.0.0.1:{args.port}")
    try:
        run_checks(api, start(), args.target)
        check_upgrade(api, container, start, args.image, data)
    except SmokeFailure as e:
        print(f"\nFAILED: {e}\n\n--- container log ---", file=sys.stderr)
        subprocess.run(["docker", "logs", container], check=False)
        return 1
    finally:
        subprocess.run(["docker", "rm", "-f", container], capture_output=True, check=False)
        subprocess.run(["docker", "volume", "rm", "-f", data], capture_output=True, check=False)
        # Anything the container wrote into the library is its user's; clear it from inside.
        subprocess.run(
            ["docker", "run", "--rm", "--entrypoint", "rm", "-v", f"{work}:/work",
             args.image, "-rf", "/work/library"],
            capture_output=True,
            check=False,
        )
        shutil.rmtree(work, ignore_errors=True)
    print("\nAll smoke checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
