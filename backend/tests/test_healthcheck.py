"""The container HEALTHCHECK probe (backend/healthcheck.py)."""
import runpy
import socket
import subprocess
import sys
import threading
from pathlib import Path

import pytest

from backend import healthcheck

SCRIPT = Path(healthcheck.__file__)


@pytest.fixture
def server():
    """A one-shot HTTP server answering with whatever status line it is given."""
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    requests = []

    def serve(response):
        def run():
            conn, _ = listener.accept()
            with conn:
                requests.append(conn.recv(1024))
                conn.sendall(response)

        threading.Thread(target=run, daemon=True).start()
        return listener.getsockname()[1]

    serve.requests = requests
    yield serve
    listener.close()


class TestCheck:
    def test_a_200_is_healthy(self, server):
        port = server(b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\n{}")
        assert healthcheck.check(port=port) is True
        assert server.requests[0].startswith(b"GET /api/health HTTP/1.0\r\n")

    def test_a_503_is_not(self, server):
        port = server(b"HTTP/1.1 503 Service Unavailable\r\n\r\n")
        assert healthcheck.check(port=port) is False

    def test_garbage_is_not(self, server):
        port = server(b"nonsense")
        assert healthcheck.check(port=port) is False

    def test_nothing_listening_is_not(self):
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        assert healthcheck.check(port=port) is False


class TestScript:
    def test_exits_by_the_result(self, monkeypatch):
        monkeypatch.setattr(socket, "create_connection", _refuse)
        with pytest.raises(SystemExit) as exit_info:
            runpy.run_path(str(SCRIPT), run_name="__main__")
        assert exit_info.value.code == 1

    def test_runs_isolated_without_site_packages(self):
        # How the Dockerfile runs it: -I -S, so it may import only the stdlib.
        result = subprocess.run(
            [sys.executable, "-I", "-S", "-c",
             f"import runpy, sys; m = runpy.run_path({str(SCRIPT)!r}); "
             "sys.exit(0 if m['check'](port=1, timeout=0.5) is False else 1)"],
            capture_output=True, timeout=30,
        )
        assert result.returncode == 0, result.stderr.decode()

    def test_the_dockerfile_uses_it(self):
        dockerfile = (SCRIPT.parent.parent / "Dockerfile").read_text()
        assert 'CMD ["python", "-I", "-S", "/app/backend/healthcheck.py"]' in dockerfile


def _refuse(*args, **kwargs):
    raise ConnectionRefusedError
