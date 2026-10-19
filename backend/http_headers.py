"""Building response headers from names users or the library chose."""

import re
from urllib.parse import quote

# C0 controls and DEL, plus C1 controls. CR/LF would end the header early;
# uvicorn refuses to send one that holds them, so the response becomes a 500.
_CONTROL = re.compile("[\x00-\x1f\x7f-\x9f]")


def content_disposition(name: str, disposition: str = "attachment") -> str:
    """A ``Content-Disposition`` header that survives any file name.

    Starlette encodes headers as Latin-1, so a raw "Mörk Borg", a CJK title or
    an emoji campaign name would 500, and a ``"`` would end the quoted value
    early. The plain ``filename`` carries an ASCII fallback with quotes and
    backslashes swapped out, and ``filename*`` the real name (RFC 6266), which
    every current browser prefers, sent only when the two differ. Control
    characters are dropped from both.
    """
    clean = _CONTROL.sub("", name) or "download"
    ascii_name = (
        clean.encode("ascii", "replace").decode("ascii").replace('"', "'").replace("\\", "_")
    )
    header = f'{disposition}; filename="{ascii_name}"'
    if ascii_name == clean:
        return header
    # surrogateescape keeps a library file name that is not valid UTF-8 (see
    # backend/filenames.py) from raising here; its raw bytes are percent-encoded.
    encoded = quote(clean.encode("utf-8", "surrogateescape"), safe="")
    return f"{header}; filename*=UTF-8''{encoded}"
