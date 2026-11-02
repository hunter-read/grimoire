/**
 * A duration as words, for a screen reader: "1 minute, 5 seconds".
 *
 * The player shows times as `1:05`, which is read aloud as "one colon oh
 * five". This spells the same time out in the reader's language, using Intl's
 * unit formatting so every locale gets its own words and plurals without a
 * translation string per unit. Zero reads as "0 seconds" rather than nothing.
 */
export function spokenDuration(seconds: number | null | undefined, locale?: string): string {
  const total = Math.max(0, Math.round(seconds || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const unit = (value: number, name: 'hour' | 'minute' | 'second') =>
    new Intl.NumberFormat(locale, { style: 'unit', unit: name, unitDisplay: 'long' }).format(value)
  const parts: string[] = []
  if (h) parts.push(unit(h, 'hour'))
  if (m) parts.push(unit(m, 'minute'))
  if (s || !parts.length) parts.push(unit(s, 'second'))
  return new Intl.ListFormat(locale, { style: 'long', type: 'unit' }).format(parts)
}
