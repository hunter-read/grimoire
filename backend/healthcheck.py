"""The container's HEALTHCHECK: exit 0 when ``/api/health`` answers 200.

Docker runs this every 30 seconds for as long as the container lives, so what it
costs is paid for ever. Only ``socket`` is imported: asking with ``urllib``
loads the HTTP, TLS and e-mail parsing modules each time, which took three times
the CPU of the check itself. Run with ``python -I -S``, which also skips the
site-packages scan.
"""
import socket
import sys

HOST = "127.0.0.1"
PORT = 9481
TIMEOUT = 4.0


def check(host: str = HOST, port: int = PORT, timeout: float = TIMEOUT) -> bool:
    """Whether the server answers its health endpoint with a 200."""
    try:
        with socket.create_connection((host, port), timeout=timeout) as conn:
            conn.sendall(b"GET /api/health HTTP/1.0\r\nHost: " + host.encode() + b"\r\n\r\n")
            status_line = conn.recv(64)
    except OSError:
        return False
    return status_line.split(b" ", 2)[1:2] == [b"200"]


if __name__ == "__main__":
    sys.exit(0 if check() else 1)
