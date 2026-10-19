"""backend.render.memory: handing MuPDF's render memory back to the OS."""
import fitz  # type: ignore[import-untyped]

from backend.render import memory


class TestReclaimRenderMemory:
    def test_reclaim_survives_missing_store_shrink(self, monkeypatch):
        # store_shrink availability varies by PyMuPDF build; a failure must not
        # propagate into the request that triggered it.
        def _boom(_):
            raise RuntimeError("no store_shrink in this build")

        monkeypatch.setattr(fitz.TOOLS, "store_shrink", _boom)
        monkeypatch.setattr(memory, "malloc_trim", None)
        memory.reclaim_render_memory()  # must not raise

    def test_reclaim_survives_malloc_trim_failure(self, monkeypatch):
        def _boom(_):
            raise OSError("trim failed")

        monkeypatch.setattr(memory, "malloc_trim", _boom)
        memory.reclaim_render_memory()  # must not raise

    def test_calls_both_native_reclaims_when_available(self, monkeypatch):
        seen = []
        monkeypatch.setattr(fitz.TOOLS, "store_shrink", lambda pct: seen.append(("shrink", pct)))
        monkeypatch.setattr(memory, "malloc_trim", lambda n: seen.append(("trim", n)))
        memory.reclaim_render_memory()
        # Order matters: free MuPDF's store first, then return the arenas.
        assert seen == [("shrink", 100), ("trim", 0)]


class TestResolveMallocTrim:
    def test_absent_off_linux(self, monkeypatch):
        monkeypatch.setattr(memory.platform, "system", lambda: "Darwin")
        assert memory.resolve_malloc_trim() is None

    def test_absent_without_glibc(self, monkeypatch):
        # musl (Alpine) has no libc.so.6 to load.
        monkeypatch.setattr(memory.platform, "system", lambda: "Linux")

        def _no_libc(_name):
            raise OSError("not found")

        monkeypatch.setattr(memory.ctypes, "CDLL", _no_libc)
        assert memory.resolve_malloc_trim() is None

    def test_found_on_glibc(self, monkeypatch):
        trim = object()
        monkeypatch.setattr(memory.platform, "system", lambda: "Linux")
        monkeypatch.setattr(memory.ctypes, "CDLL", lambda _name: type("Libc", (), {"malloc_trim": trim}))
        assert memory.resolve_malloc_trim() is trim
