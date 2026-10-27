"""Per-book claims: which book's file and index something is working on (issue #657).

A replace upload swaps a book's file and resets its index, so it must never run
on a book a worker is reading at the same moment - an OCR worker resuming from a
page checkpoint would splice the new file's pages onto the old file's text and
then write the stale checkpoint back over the reset. Refusing every replace
while *any* background job ran was the old guard, and it made a batch of
replaces fail on the re-index the previous replace had just started.

A claim narrows that to the one book. The replace upload, the replace re-index
queue and the OCR worker each claim a book before touching it and release it
afterwards; whoever finds the book already claimed backs off.

Held in Valkey when it is available, so every worker sees the same claims, and
in-process otherwise, like the scan status.
"""
import threading

from ...config import logger, valkey_client, valkey_errors

_CLAIM_PREFIX = "grimoire:book_claim:"
# A claim left by a process that died mid-book expires after this long. A
# replace also overrides any claim when no background job is live (see
# ``claim_book``), so this only bounds how long a dead claim can block a replace
# while a later job is running.
_CLAIM_TTL_SECONDS = 86400

_claims: set[str] = set()
_claims_lock = threading.Lock()


def claim_book(book_id: str, force: bool = False) -> bool:
    """Claim a book; False when someone else already holds it.

    ``force`` takes the claim regardless, for a caller that knows no worker is
    running and any existing claim must be left over from one that died.
    """
    if (client := valkey_client()) is not None:
        try:
            return bool(
                client.set(_CLAIM_PREFIX + book_id, "1", nx=not force, ex=_CLAIM_TTL_SECONDS)
            )
        except valkey_errors() as e:
            logger.warning("Valkey set(claim) failed, using in-process claims: %s", e)
    with _claims_lock:
        if book_id in _claims and not force:
            return False
        _claims.add(book_id)
        return True


def release_book(book_id: str) -> None:
    """Drop a claim taken by ``claim_book``."""
    if (client := valkey_client()) is not None:
        try:
            client.delete(_CLAIM_PREFIX + book_id)
        except valkey_errors() as e:
            logger.warning("Valkey delete(claim) failed, using in-process claims: %s", e)
    with _claims_lock:
        _claims.discard(book_id)
