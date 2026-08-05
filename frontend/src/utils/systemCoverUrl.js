import { mediaUrl } from '../api'

/**
 * The image URL for a game system's cover, or null when it has none.
 *
 * Precedence mirrors the backend: a `cover.*`/`folder.*` image in the system's
 * library folder or an admin upload (both served by `/systems/:id/cover`) beats
 * a book thumbnail derived from the system's contents.
 *
 * Container folders (issues #261, #262) hold no books of their own, so the
 * cover endpoint is the only source of art they have.
 */
export function systemCoverUrl(system) {
  if (!system) return null
  if (system.has_cover) return mediaUrl(`/systems/${system.id}/cover`)
  if (system.cover_book_id) return mediaUrl(`/books/${system.cover_book_id}/thumbnail`)
  return null
}
