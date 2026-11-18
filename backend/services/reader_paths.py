"""How a system's place in the library reads to one user.

A container's access level does not reach the systems inside it, so a reader
may see a system whose container is hidden from them. Everything that names
where such a system sits goes through :class:`ReaderPaths`: its parent link,
its category depth and the paths of its books leave out the containers the
reader may not see, as the container's own page does.
"""
from typing import Any, Optional

from sqlalchemy.orm import Session

from ..models import Book, GameSystem
from . import access_control
from .systems import book_relative_path, browsable_system_ids


class ReaderPaths:
    """Containers hidden from one reader, and the paths and links that skip them.

    Built once per request and asked about many systems or books; the system
    tree is loaded on first use, and not at all for an admin.
    """

    def __init__(self, db: Session, current_user: Any) -> None:
        self.db = db
        self.user = current_user
        self.sees_everything = access_control.sees_everything(current_user)
        self._parents: dict[str, Optional[str]] = {}
        self._hidden: Optional[set[str]] = None

    def _load(self) -> set[str]:
        if self._hidden is not None:
            return self._hidden
        self._hidden = set()
        if self.sees_everything:
            return self._hidden
        self._parents = dict(self.db.query(GameSystem.id, GameSystem.parent_id).all())
        container_ids = {pid for pid in self._parents.values() if pid}
        if container_ids:
            containers = (
                self.db.query(GameSystem).filter(GameSystem.id.in_(container_ids)).all()
            )
            allowed = browsable_system_ids(self.db, containers, self.user)
            self._hidden = {c.id for c in containers if c.id not in allowed}
        return self._hidden

    def parent_shown(self, system: GameSystem) -> bool:
        """Whether ``system``'s container may be named to the reader (False with none)."""
        return bool(system.parent_id) and system.parent_id not in self._load()

    def shown_parent_id(self, system: GameSystem) -> Optional[str]:
        """``system.parent_id``, or None when that container is hidden from the reader."""
        return system.parent_id if self.parent_shown(system) else None

    def _ancestors(self, system_id: str) -> list[str]:
        """``system_id``'s enclosing containers, outermost first."""
        chain: list[str] = []
        seen = {system_id}
        current = self._parents.get(system_id)
        while current and current not in seen:
            seen.add(current)
            chain.append(current)
            current = self._parents.get(current)
        chain.reverse()
        return chain

    def _hidden_positions(self, system_id: Optional[str]) -> set[int]:
        """Indices in a book path of the hidden containers above ``system_id``.

        A path is ``books/{containers…}/{System}/…``, outermost container at 1.
        """
        hidden = self._load()
        if not hidden or not system_id:
            return set()
        return {i for i, cid in enumerate(self._ancestors(system_id), start=1) if cid in hidden}

    def category_depth(self, system_id: Optional[str], depth: int) -> int:
        """``depth`` less one for each hidden container above ``system_id``.

        The client reads the category dir at this index of the paths
        :meth:`cut` returns.
        """
        return depth - len(self._hidden_positions(system_id))

    def cut(self, path: Optional[str], system_id: Optional[str]) -> str:
        """``path`` under ``system_id`` without the folders of hidden containers.

        The filename is never cut, even from a path shorter than expected.
        """
        if path is None:
            return ""
        drop = self._hidden_positions(system_id)
        if not drop:
            return path
        parts = path.replace("\\", "/").split("/")
        return "/".join(p for i, p in enumerate(parts) if i not in drop or i == len(parts) - 1)

    def book_path(self, book: Book, system: Optional[GameSystem]) -> str:
        """The ``relative_path`` to show for ``book``, given its visible ``system``.

        ``system`` is None when the book's own system is hidden from the reader,
        and then the path loses every folder that would name it
        (``services.systems.book_relative_path``). Otherwise only the folders of
        hidden containers above it are cut.
        """
        if system is None and book.game_system_id:
            return book_relative_path(self.db, book, None)
        return self.cut(book.relative_path, book.game_system_id)
