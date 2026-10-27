/**
 * Shared bits for the tag browser's download buttons (issue #401).
 *
 * The tag page has three nested scopes that can each be archived — the whole
 * tag, one resource-type section, one tagged folder — and all three render the
 * same small button. Keeping the style and the params here means the three
 * components stay in step and none of them has to know how the endpoint spells
 * its query string.
 */

/** Matches the folder-download button on the media galleries. */
export const tagZipBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  padding: '2px 7px',
  borderRadius: 5,
  fontSize: 12,
  flexShrink: 0,
  color: 'var(--text-muted)',
  border: '1px solid var(--border)',
  background: 'var(--bg-card)',
  cursor: 'pointer',
}

/**
 * Resource types that can be archived from a tag.
 *
 * A tagged *system* is a whole shelf rather than a file, so the backend leaves
 * it out of tag archives and its section shows no download button — the system
 * has its own page with its own download. Keep this in step with
 * `_TAG_ARCHIVE_TYPES` in `backend/routers/downloads/_helpers.py`.
 */
export const DOWNLOADABLE_TAG_TYPES = ['book', 'map', 'token', 'audio', 'model']

export const canDownloadTagType = (type) => DOWNLOADABLE_TAG_TYPES.includes(type)
