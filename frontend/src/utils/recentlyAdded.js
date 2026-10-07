// How recently an item must have been added to the library to carry the "new"
// badge and pass the "recently added" filter (issue #199).
export const RECENTLY_ADDED_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Milliseconds since the epoch for an `added_at` value, or null when the book
 * has none (added before dates were tracked) or it does not parse.
 */
export function addedAtTime(addedAt) {
  if (!addedAt) return null
  const ts = Date.parse(addedAt)
  return Number.isNaN(ts) ? null : ts
}

/**
 * Whether an item added at `addedAt` falls inside the recent window. One with
 * no recorded date is never recent - it predates tracking, so it is old.
 */
export function isRecentlyAdded(addedAt, now = Date.now()) {
  const ts = addedAtTime(addedAt)
  return ts !== null && now - ts < RECENTLY_ADDED_DAYS * DAY_MS
}

/**
 * Compare two items by when they were added, `dir` 1 for oldest first and -1
 * for newest first. Items with no recorded date sort last in both directions -
 * flipping them to the top of an "oldest first" list would bury real dates
 * under every legacy item. Ties return 0 so the caller can break them.
 */
export function compareAddedAt(a, b, dir = 1) {
  const ta = addedAtTime(a?.added_at)
  const tb = addedAtTime(b?.added_at)
  if (ta === null || tb === null) {
    if (ta === tb) return 0
    return ta === null ? 1 : -1
  }
  return dir * (ta - tb)
}
