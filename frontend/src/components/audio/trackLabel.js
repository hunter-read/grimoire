import { formatDuration, formatSize } from '../../utils'

/** `01 - Thorwal.mp3` -> `01 - Thorwal`. A name with no extension is unchanged. */
export function stripExtension(filename = '') {
  const dot = filename.lastIndexOf('.')
  return dot > 0 ? filename.slice(0, dot) : filename
}

/**
 * A track's gallery label (issue #494): its tag title, led by the track number
 * when it has one (`03 · Die Sümpfe Harodiens`), so an album listed by title
 * keeps the running order its filenames used to carry.
 *
 * With no title tag it falls back to the filename without its extension, and no
 * number - an untagged file's name usually carries its own (`03 - …`). Archives
 * keep their whole filename, extension included, as the one clue to what they
 * are.
 */
export function trackLabel(item) {
  if (item.is_archive) return item.filename
  if (!item.title) return stripExtension(item.filename)
  if (!item.track_number) return item.title
  return `${String(item.track_number).padStart(2, '0')} · ${item.title}`
}

/**
 * The secondary line under a track's label: `artist · album · duration`. A file
 * with neither tag shows its size in their place, as every row did before.
 */
export function trackDetails(item) {
  const parts = [item.artist, item.album].filter(Boolean)
  if (!parts.length) parts.push(formatSize(item.file_size || 0))
  if (item.duration > 0) parts.push(formatDuration(item.duration))
  return parts.join(' · ')
}
