"""The render burst probe (issue #975): a real server, a burst of cold tiles.

Slow and opt-in, so it is not part of the normal suite or CI. It starts uvicorn
in a subprocess with ``RENDER_WORKERS=0`` and a library of its own, fires a
burst of uncached zoom tiles at once, and polls ``/api/health`` and
``/api/books`` every 50 ms while they render. It fails if any poll of
``/api/health`` took a second or more, or if any request answered 500. See
docs/performance.md#the-burst-probe.

    RENDER_PROBE=1 python3 -m pytest backend/tests/test_render_burst_probe.py -s

Knobs, all optional:

* ``RENDER_PROBE_WORKERS`` - the server's ``RENDER_WORKERS`` (default ``0``).
* ``RENDER_PROBE_TILES`` - how many tiles the burst asks for (default ``60``).
* ``RENDER_PROBE_PDF`` - a PDF of your own to zoom into, instead of the
  generated one: a heavily illustrated book is the hard case.
"""
import asyncio
import io
import json
import math
import os
import random
import shutil
import socket
import subprocess
import sys
import tempfile
import time

import httpx
import pymupdf
import pytest
from PIL import Image

ENABLED = os.environ.get("RENDER_PROBE", "").strip().lower() in ("1", "true", "yes")

pytestmark = [
    pytest.mark.render_probe,
    pytest.mark.skipif(not ENABLED, reason="the render burst probe is opt-in: set RENDER_PROBE=1"),
]

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
WORKERS = os.environ.get("RENDER_PROBE_WORKERS", "0")
TILES = int(os.environ.get("RENDER_PROBE_TILES", "60"))
OWN_PDF = os.environ.get("RENDER_PROBE_PDF", "").strip()
# The zoom the burst renders at: 4x a 1024px page, as a deep zoom asks for.
WIDTH = 4096
TILE = 1024
POLL_EVERY = 0.05
# The acceptance bar: /api/health answers within this throughout the burst.
HEALTH_LIMIT = 1.0
USER = {"username": "probe", "password": "probe-password-1234"}


def _illustrated_pdf(path: str, pages: int) -> None:
    """Pages that are slow to rasterise: a full-page photo under dense vector art."""
    rnd = random.Random(975)
    doc = pymupdf.open()
    for number in range(pages):
        page = doc.new_page(width=612, height=792)
        photo = io.BytesIO()
        Image.effect_noise((2400, 3100), 60).convert("RGB").save(photo, "JPEG", quality=90)
        page.insert_image(page.rect, stream=photo.getvalue())
        shape = page.new_shape()
        for _ in range(4000):
            x, y = rnd.uniform(0, 612), rnd.uniform(0, 792)
            shape.draw_bezier(
                (x, y),
                (x + 30, y + 30),
                (x + 30, y - 30),
                (x + rnd.uniform(-60, 60), y + rnd.uniform(-60, 60)),
            )
            shape.finish(
                color=(rnd.random(), rnd.random(), rnd.random()),
                fill=(rnd.random(), 0.2, 0.5),
                fill_opacity=0.3,
                width=0.6,
            )
        shape.commit()
        page.insert_text((72, 72), f"Probe page {number + 1}", fontsize=24)
    doc.save(path, deflate=True)
    doc.close()


def _tiles(path: str, count: int) -> list[tuple[int, int, int]]:
    """``count`` (page, col, row) tiles at WIDTH, page by page from the first."""
    tiles: list[tuple[int, int, int]] = []
    with pymupdf.open(path) as doc:
        for number, page in enumerate(doc, start=1):
            cols = math.ceil(WIDTH / TILE)
            rows = math.ceil(page.rect.height * WIDTH / page.rect.width / TILE)
            tiles += [(number, col, row) for row in range(rows) for col in range(cols)]
            if len(tiles) >= count:
                return tiles[:count]
    return tiles


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@pytest.fixture
def server():
    """A uvicorn serving a fresh library holding one book; yields (base URL, PDF)."""
    root = tempfile.mkdtemp(prefix="grimoire-probe-")
    folder = os.path.join(root, "library", "books", "Probe System", "Core")
    os.makedirs(folder)
    pdf = os.path.join(folder, "Probe Book.pdf")
    if OWN_PDF:
        shutil.copyfile(OWN_PDF, pdf)
    else:
        _illustrated_pdf(pdf, pages=math.ceil(TILES / 24))
    port = _free_port()
    env = {
        **{k: v for k, v in os.environ.items() if k not in ("DATABASE_URL", "VALKEY_URL")},
        "DATA_PATH": os.path.join(root, "data"),
        "LIBRARY_PATH": os.path.join(root, "library"),
        "RENDER_WORKERS": WORKERS,
        "OCR_ENABLED": "false",
        "LIBRARY_WATCH": "false",
    }
    log = open(os.path.join(root, "server.log"), "wb")
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1",
         "--port", str(port), "--log-level", "warning"],
        cwd=REPO, env=env, stdout=log, stderr=subprocess.STDOUT,
    )  # fmt: skip
    try:
        yield f"http://127.0.0.1:{port}", pdf
    finally:
        proc.terminate()
        try:
            proc.wait(15)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(5)
        log.close()
        shutil.rmtree(root, ignore_errors=True)


async def _ready(client: httpx.AsyncClient) -> tuple[dict[str, str], str]:
    """Sign in once the server answers, and wait for the startup scan to file the book."""
    deadline = time.monotonic() + 120
    while True:
        try:
            if (await client.get("/api/health")).status_code == 200:
                break
        except httpx.HTTPError:
            pass
        assert time.monotonic() < deadline, "the server never answered /api/health"
        await asyncio.sleep(0.25)
    r = await client.post("/api/auth/setup", json=USER)
    assert r.status_code == 200, r.text
    headers = {"Authorization": f"Bearer {r.json()['token']}"}
    while True:
        books = (await client.get("/api/books", headers=headers)).json()["books"]
        status = (await client.get("/api/scan-status", headers=headers)).json()
        if books and not status.get("running"):
            return headers, books[0]["id"]
        assert time.monotonic() < deadline, "the startup scan never filed the book"
        await asyncio.sleep(0.25)


async def _burst(base: str, pdf: str) -> dict:
    limits = httpx.Limits(max_connections=TILES + 10)
    async with httpx.AsyncClient(base_url=base, timeout=300, limits=limits) as client:
        headers, book = await _ready(client)
        done = asyncio.Event()
        polls: dict[str, list[tuple[float, int]]] = {"/api/health": [], "/api/books": []}

        async def poll(path: str) -> None:
            while not done.is_set():
                started = time.perf_counter()
                r = await client.get(path, headers=headers)
                polls[path].append((time.perf_counter() - started, r.status_code))
                await asyncio.sleep(POLL_EVERY)

        async def tile(page: int, col: int, row: int) -> int:
            r = await client.get(
                f"/api/books/{book}/page/{page}/tile",
                params={"width": WIDTH, "col": col, "row": row},
                headers=headers,
            )
            return r.status_code

        pollers = [asyncio.create_task(poll(path)) for path in polls]
        await asyncio.sleep(0.2)
        started = time.perf_counter()
        statuses = await asyncio.gather(*(tile(*t) for t in _tiles(pdf, TILES)))
        wall = time.perf_counter() - started
        await asyncio.sleep(0.3)
        done.set()
        await asyncio.gather(*pollers)

    counts: dict[int, int] = {}
    for status in statuses:
        counts[status] = counts.get(status, 0) + 1
    return {
        "render_workers": WORKERS,
        "tiles": len(statuses),
        "tile_statuses": counts,
        "burst_seconds": round(wall, 2),
        **{
            f"{path.rsplit('/', 1)[-1]}_slowest_ms": round(max(t for t, _ in results) * 1000, 1)
            for path, results in polls.items()
        },
        **{
            f"{path.rsplit('/', 1)[-1]}_statuses": sorted({s for _, s in results})
            for path, results in polls.items()
        },
    }


def test_a_render_burst_leaves_the_api_answering(server):
    base, pdf = server
    result = asyncio.run(_burst(base, pdf))
    print("\nrender burst probe:", json.dumps(result, sort_keys=True))
    assert 200 in result["tile_statuses"], result
    assert set(result["tile_statuses"]) <= {200, 503}, result
    assert result["health_statuses"] == [200], result
    assert result["books_statuses"] == [200], result
    assert result["health_slowest_ms"] < HEALTH_LIMIT * 1000, result
