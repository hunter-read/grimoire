// Formatting helpers shared by the backup UI.

// Human-readable byte size. Backups run from a few MB to several GB, so the
// unit is picked per value rather than fixed.
export function formatBytes(bytes) {
  if (!bytes || bytes < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  // Bytes and KB read oddly with decimals; larger units need one.
  const decimals = unit <= 1 ? 0 : 1
  return `${value.toFixed(decimals)} ${units[unit]}`
}

// Absolute local timestamp for a backup, e.g. "21 Aug 2026, 14:03".
export function formatTimestamp(iso, locale) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(locale || undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// How long ago a backup was taken, as a coarse bucket. The exact timestamp is
// shown alongside; this is the at-a-glance "is my newest backup stale?" read.
export function relativeAge(iso, now = Date.now()) {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  const seconds = Math.max(0, Math.floor((now - then) / 1000))
  if (seconds < 60) return { unit: 'justNow', count: 0 }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return { unit: 'minutes', count: minutes }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { unit: 'hours', count: hours }
  return { unit: 'days', count: Math.floor(hours / 24) }
}
