"""Chapter markers embedded in audiobook files (issue #564).

Audiobooks (``.m4b``, and the odd ``.m4a``/``.mp3``) carry a list of chapter
start times so a listener can jump between them. Three layouts are in the wild:

* **Nero ``chpl``** - a flat list in ``moov/udta/chpl`` (ffmpeg, many rippers).
* **QuickTime chapter track** - a text track the audio track points at through
  ``tref/chap``; each text sample is one chapter title, its timing the start
  (Apple tools write only this).
* **ID3 ``CHAP`` frames** - MP3 audiobooks.

Mutagen exposes ``chpl`` but scales its start times by the movie timescale,
which is wrong (they are always in 100 ns units), and does not read chapter
tracks at all - so the MP4 layouts are parsed here on top of mutagen's atom
walker. Reading is on demand rather than at scan time: the atom walk seeks past
the media data, so even a multi-hour file is a handful of small reads.
"""
import logging
import struct
from typing import Any, BinaryIO

logger = logging.getLogger("grimoire.indexer")

# A real audiobook has tens of chapters; anything past this is a corrupt table,
# and capping it keeps a hostile file from turning one request into a long loop.
MAX_CHAPTERS = 2000
# A chapter title sample is a short string; refuse to read anything larger.
_MAX_TITLE_SAMPLE = 4096

Chapter = dict[str, Any]


def read_chapters(filepath: str) -> list[Chapter]:
    """Return ``[{"start": seconds, "title": str}, ...]`` ordered by start.

    Never raises: a file without chapters, an unsupported format, or a damaged
    table all yield ``[]``, since chapters are a navigation aid, not data the
    track depends on.
    """
    try:
        with open(filepath, "rb") as fh:
            head = fh.read(12)
            if head[4:8] == b"ftyp":
                chapters = _mp4_chapters(fh)
            elif head[:3] == b"ID3":
                chapters = _id3_chapters(filepath)
            else:
                chapters = []
    except Exception as exc:
        logger.debug(f"Could not read chapters from '{filepath}': {exc}")
        return []
    return _normalise(chapters)


def _normalise(chapters: list[Chapter]) -> list[Chapter]:
    """Sort by start, drop negative starts, and round for a stable payload."""
    out = [
        {"start": round(float(c["start"]), 3), "title": str(c["title"]).strip()}
        for c in chapters
        if c["start"] >= 0
    ]
    out.sort(key=lambda c: c["start"])
    return out[:MAX_CHAPTERS]


# ---------------------------------------------------------------------------
# MP4 / M4B
# ---------------------------------------------------------------------------


def _mp4_chapters(fh: BinaryIO) -> list[Chapter]:
    from mutagen.mp4 import Atoms  # local import keeps startup light

    fh.seek(0)
    atoms = Atoms(fh)
    try:
        moov = atoms.path(b"moov")[-1]
    except KeyError:
        return []
    try:
        chpl = _child(moov, b"udta", b"chpl")
    except KeyError:
        chpl = None
    if chpl is not None:
        chapters = _parse_chpl(_payload(chpl, fh))
        if chapters:
            return chapters
    return _quicktime_chapters(moov, fh)


def _child(atom: Any, *path: bytes) -> Any:
    """Descend ``path`` from ``atom``; raises KeyError when a step is missing.

    Mutagen's ``atom[...]`` takes the path as a sequence, so a lone
    ``atom[b"tkhd"]`` would walk the bytes one integer at a time - always go
    through this helper instead.
    """
    return atom[path]


def _payload(atom: Any, fh: BinaryIO) -> bytes:
    ok, data = atom.read(fh)
    if not ok:
        raise ValueError(f"truncated {atom.name!r} atom")
    return bytes(data)


def _parse_chpl(data: bytes) -> list[Chapter]:
    """Parse a Nero ``chpl`` payload (start times in 100 ns units)."""
    version = data[0]
    # Version 1 adds four reserved bytes before the one-byte chapter count.
    pos = 8 if version == 1 else 4
    count = data[pos]
    pos += 1
    chapters: list[Chapter] = []
    for _ in range(count):
        (start,) = struct.unpack(">Q", data[pos : pos + 8])
        title_len = data[pos + 8]
        title = data[pos + 9 : pos + 9 + title_len].decode("utf-8", errors="replace")
        pos += 9 + title_len
        chapters.append({"start": start / 10_000_000, "title": title})
    return chapters


def _quicktime_chapters(moov: Any, fh: BinaryIO) -> list[Chapter]:
    """Read the text track that another track names in its ``tref/chap``."""
    tracks: dict[int, Any] = {}
    chapter_ids: list[int] = []
    for trak in moov.findall(b"trak"):
        try:
            tkhd = _payload(_child(trak, b"tkhd"), fh)
        except KeyError:
            continue
        # Version 1 widens the creation/modification times to 64 bits.
        id_at = 20 if tkhd[0] == 1 else 12
        (track_id,) = struct.unpack(">I", tkhd[id_at : id_at + 4])
        tracks[track_id] = trak
        try:
            tref = _payload(_child(trak, b"tref"), fh)
        except KeyError:
            continue
        chapter_ids.extend(_tref_chap_ids(tref))
    for track_id in chapter_ids:
        trak = tracks.get(track_id)
        if trak is not None:
            chapters = _text_track_samples(trak, fh)
            if chapters:
                return chapters
    return []


def _tref_chap_ids(tref: bytes) -> list[int]:
    """Track ids listed in the ``chap`` reference inside a ``tref`` payload."""
    ids: list[int] = []
    pos = 0
    while pos + 8 <= len(tref):
        size, kind = struct.unpack(">I4s", tref[pos : pos + 8])
        if size < 8:
            break
        if kind == b"chap":
            body = tref[pos + 8 : pos + size]
            ids.extend(struct.unpack(f">{len(body) // 4}I", body[: len(body) // 4 * 4]))
        pos += size
    return ids


def _text_track_samples(trak: Any, fh: BinaryIO) -> list[Chapter]:
    """Decode a text track's samples into chapters, timed by its ``stts``."""
    mdhd = _payload(_child(trak, b"mdia", b"mdhd"), fh)
    scale_at = 20 if mdhd[0] == 1 else 12
    (timescale,) = struct.unpack(">I", mdhd[scale_at : scale_at + 4])
    if not timescale:
        return []
    stbl = _child(trak, b"mdia", b"minf", b"stbl")
    starts = _sample_starts(_payload(_child(stbl, b"stts"), fh))
    sizes = _sample_sizes(_payload(_child(stbl, b"stsz"), fh))
    offsets = _sample_offsets(stbl, fh, sizes)

    chapters: list[Chapter] = []
    for start, size, offset in zip(starts, sizes, offsets):
        chapters.append({"start": start / timescale, "title": _read_text_sample(fh, offset, size)})
        if len(chapters) >= MAX_CHAPTERS:
            break
    return chapters


def _sample_starts(stts: bytes) -> list[int]:
    """Cumulative start time (in track units) of each sample."""
    (entries,) = struct.unpack(">I", stts[4:8])
    starts: list[int] = []
    t = 0
    for i in range(entries):
        count, delta = struct.unpack(">II", stts[8 + i * 8 : 16 + i * 8])
        for _ in range(min(count, MAX_CHAPTERS - len(starts))):
            starts.append(t)
            t += delta
    return starts


def _sample_sizes(stsz: bytes) -> list[int]:
    uniform, count = struct.unpack(">II", stsz[4:12])
    count = min(count, MAX_CHAPTERS)
    if uniform:
        return [uniform] * count
    return list(struct.unpack(f">{count}I", stsz[12 : 12 + count * 4]))


def _sample_offsets(stbl: Any, fh: BinaryIO, sizes: list[int]) -> list[int]:
    """File offset of each sample, from the chunk table and samples-per-chunk."""
    try:
        stco = _payload(_child(stbl, b"stco"), fh)
        width = "I"
    except KeyError:
        stco = _payload(_child(stbl, b"co64"), fh)
        width = "Q"
    (n_chunks,) = struct.unpack(">I", stco[4:8])
    chunk_offsets = struct.unpack(f">{n_chunks}{width}", stco[8:])

    stsc = _payload(_child(stbl, b"stsc"), fh)
    (n_runs,) = struct.unpack(">I", stsc[4:8])
    runs = [struct.unpack(">III", stsc[8 + i * 12 : 20 + i * 12]) for i in range(n_runs)]

    offsets: list[int] = []
    sample = 0
    for chunk_no, chunk_offset in enumerate(chunk_offsets, start=1):
        per_chunk = _samples_in_chunk(runs, chunk_no)
        pos = chunk_offset
        for _ in range(per_chunk):
            if sample >= len(sizes):
                return offsets
            offsets.append(pos)
            pos += sizes[sample]
            sample += 1
    return offsets


def _samples_in_chunk(runs: list[tuple[int, ...]], chunk_no: int) -> int:
    """``stsc`` runs apply from their first chunk until the next run starts."""
    per_chunk = 0
    for first_chunk, samples, _desc in runs:
        if first_chunk > chunk_no:
            break
        per_chunk = samples
    return per_chunk


def _read_text_sample(fh: BinaryIO, offset: int, size: int) -> str:
    """A QuickTime text sample: a 16-bit byte length, then the string."""
    if size < 2 or size > _MAX_TITLE_SAMPLE:
        return ""
    fh.seek(offset)
    data = fh.read(size)
    (length,) = struct.unpack(">H", data[:2])
    text = data[2 : 2 + length]
    if text.startswith((b"\xfe\xff", b"\xff\xfe")):
        return text.decode("utf-16", errors="replace")
    return text.decode("utf-8", errors="replace")


# ---------------------------------------------------------------------------
# MP3 (ID3 CHAP)
# ---------------------------------------------------------------------------


def _id3_chapters(filepath: str) -> list[Chapter]:
    from mutagen.id3 import ID3

    chapters: list[Chapter] = []
    for chap in ID3(filepath).getall("CHAP"):
        chapters.append({"start": chap.start_time / 1000, "title": _chap_title(chap)})
    return chapters


def _chap_title(chap: Any) -> str:
    titles = chap.sub_frames.getall("TIT2")
    return str(titles[0].text[0]) if titles and titles[0].text else ""
