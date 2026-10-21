// Formatting for the server's activity timestamps (issue #576).

/**
 * Parse a server timestamp. The API sends naive UTC (`2026-10-21T14:02:00`),
 * which the browser would otherwise read as local time.
 */
export function parseUtc(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const normalized = /(Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['second', 60],
  ['minute', 60],
  ['hour', 24],
  ['day', 30],
  ['month', 12],
  ['year', Infinity],
]

/** "5 minutes ago", "yesterday", "3 months ago" - in the given locale. */
export function formatRelative(date: Date, locale: string, now: Date = new Date()): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  let value = Math.min(0, (date.getTime() - now.getTime()) / 1000)
  for (const [unit, size] of STEPS) {
    if (Math.abs(value) < size) {
      // Under a minute reads as "now" rather than a ticking seconds count.
      return unit === 'second' ? rtf.format(0, 'second') : rtf.format(Math.round(value), unit)
    }
    value /= size
  }
  return rtf.format(Math.round(value), 'year')
}

/** "Oct 21, 2026, 2:02 PM" - the exact moment, for a tooltip or detail line. */
export function formatDateTime(date: Date, locale: string): string {
  return date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
}

/** How recent a timestamp is, for toning it down as it ages. */
export function recency(
  date: Date | null,
  now: Date = new Date()
): 'never' | 'day' | 'month' | 'older' {
  if (!date) return 'never'
  const age = now.getTime() - date.getTime()
  if (age < 24 * 60 * 60 * 1000) return 'day'
  if (age < 30 * 24 * 60 * 60 * 1000) return 'month'
  return 'older'
}
