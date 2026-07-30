export function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1048576).toFixed(1) + ' MB'
}

/** Format a duration in seconds as m:ss (or h:mm:ss for long tracks). */
export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`
  return `${m}:${ss}`
}

import { capitalizeWord } from './utils/acronyms'

/**
 * Humanize a slug/folder name for display: dashes/underscores become spaces and
 * each word is capitalized, keeping well-known acronyms in canonical casing
 * ("gm-tools" → "GM Tools").
 */
export function toTitleCase(str) {
  if (!str) return str
  return str.replace(/[-_]+/g, ' ').replace(/\S+/g, capitalizeWord)
}
