// Multi-part suffixes the backend treats as one extension (`archive_ext`).
// Split naively on the last dot and `book.tar.gz` would offer ".gz" as the
// extension and let the user rewrite "book.tar" — quietly changing the archive
// type Grimoire infers.
const COMPOUND_EXTS = ['.tar.gz', '.tar.bz2', '.tar.xz', '.tar.zst']

/**
 * Split a filename into its editable stem and its fixed extension.
 *
 * Folders and extensionless files return an empty extension, so callers can
 * treat every case the same way. A leading-dot name (`.nsfw`) is all stem: the
 * dot marks a hidden file, not an extension, and offering to rename ".nsfw" to
 * "x.nsfw" would be wrong.
 */
export function splitExtension(name, isDir = false) {
  if (isDir) return { stem: name, ext: '' }

  const lower = name.toLowerCase()
  for (const ext of COMPOUND_EXTS) {
    if (lower.endsWith(ext) && name.length > ext.length) {
      return { stem: name.slice(0, -ext.length), ext: name.slice(-ext.length) }
    }
  }

  const dot = name.lastIndexOf('.')
  // `dot <= 0` covers both "no dot" and a leading-dot hidden file.
  if (dot <= 0 || dot === name.length - 1) return { stem: name, ext: '' }
  return { stem: name.slice(0, dot), ext: name.slice(dot) }
}

/** Rejoin a user-edited stem with the extension it must keep. */
export function joinExtension(stem, ext) {
  return `${stem.trim()}${ext}`
}
