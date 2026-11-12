"""Zip archives that are damaged in ways ``zipfile`` reports differently.

``zipfile.ZipFile(...)`` only parses the central directory, so each archive in
``ALL`` opens without error and fails later, when the member is read - each
with a different exception. Those in ``UNOPENABLE`` fail in the constructor,
with something other than ``BadZipFile``.
"""
import io
import struct
import zipfile

MEMBER = "page.md"
_TEXT = b"# Page\n\n" + b"Some text worth compressing. " * 40


def _build(compression: int) -> bytearray:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression) as zf:
        zf.writestr(MEMBER, _TEXT)
    return bytearray(buf.getvalue())


def _offsets(data: bytearray) -> tuple[int, int, int]:
    """(local header, central header, start of member data) offsets."""
    local = data.index(b"PK\x03\x04")
    central = data.index(b"PK\x01\x02")
    name_len, extra_len = struct.unpack_from("<HH", data, local + 26)
    return local, central, local + 30 + name_len + extra_len


def _set_flag(data: bytearray, bit: int) -> None:
    local, central, _ = _offsets(data)
    for at in (local + 6, central + 8):
        struct.pack_into("<H", data, at, struct.unpack_from("<H", data, at)[0] | bit)


def _set_method(data: bytearray, method: int) -> None:
    local, central, _ = _offsets(data)
    struct.pack_into("<H", data, local + 8, method)
    struct.pack_into("<H", data, central + 10, method)


def encrypted() -> bytes:
    """Flagged as encrypted: RuntimeError, a password is required."""
    data = _build(zipfile.ZIP_STORED)
    _set_flag(data, 0x1)
    return bytes(data)


def deflate64() -> bytes:
    """Method 9 (Deflate64), which zipfile cannot decompress: NotImplementedError."""
    data = _build(zipfile.ZIP_DEFLATED)
    _set_method(data, 9)
    return bytes(data)


def unknown_method() -> bytes:
    """A method number nothing defines: NotImplementedError."""
    data = _build(zipfile.ZIP_STORED)
    _set_method(data, 99)
    return bytes(data)


def bad_crc() -> bytes:
    """Stored bytes changed after the CRC was taken: BadZipFile on read."""
    data = _build(zipfile.ZIP_STORED)
    _, _, start = _offsets(data)
    data[start] ^= 0xFF
    return bytes(data)


def corrupt_deflate() -> bytes:
    """Deflate data that is not a valid stream: zlib.error."""
    data = _build(zipfile.ZIP_DEFLATED)
    _, _, start = _offsets(data)
    data[start] = 0xFF  # reserved block type 3
    return bytes(data)


def corrupt_lzma() -> bytes:
    """LZMA data that is not a valid stream: lzma.LZMAError."""
    data = _build(zipfile.ZIP_LZMA)
    _, _, start = _offsets(data)
    for i in range(start + 4, start + 24):
        data[i] ^= 0xFF
    return bytes(data)


def negative_offset() -> bytes:
    """A directory that claims to start past where it does: a negative seek, ValueError."""
    data = _build(zipfile.ZIP_STORED)
    end = data.index(b"PK\x05\x06")
    struct.pack_into("<I", data, end + 16, struct.unpack_from("<I", data, end + 16)[0] + 1)
    return bytes(data)


def bad_local_name() -> bytes:
    """A local header name flagged UTF-8 that isn't: UnicodeDecodeError on read."""
    data = _build(zipfile.ZIP_STORED)
    local, _, _ = _offsets(data)
    struct.pack_into("<H", data, local + 6, struct.unpack_from("<H", data, local + 6)[0] | 0x800)
    data[local + 30] = 0xFF
    return bytes(data)


def future_version() -> bytes:
    """A member needing a newer zip version than zipfile knows: NotImplementedError."""
    data = _build(zipfile.ZIP_STORED)
    _, central, _ = _offsets(data)
    data[central + 6] = 119  # version 11.9
    return bytes(data)


def bad_central_name() -> bytes:
    """A directory name flagged UTF-8 that isn't: UnicodeDecodeError on open."""
    data = _build(zipfile.ZIP_STORED)
    _, central, _ = _offsets(data)
    at = central + 8
    struct.pack_into("<H", data, at, struct.unpack_from("<H", data, at)[0] | 0x800)
    data[central + 46] = 0xFF
    return bytes(data)


ALL = {
    "encrypted": encrypted,
    "deflate64": deflate64,
    "unknown_method": unknown_method,
    "bad_crc": bad_crc,
    "corrupt_deflate": corrupt_deflate,
    "corrupt_lzma": corrupt_lzma,
    "negative_offset": negative_offset,
    "bad_local_name": bad_local_name,
}

UNOPENABLE = {
    "future_version": future_version,
    "bad_central_name": bad_central_name,
}
