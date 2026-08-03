/**
 * Render a book's variable-precision publication date.
 *
 * Grimoire stores year, month, and day separately and any of them may be unset,
 * so "2016", "March 2016", and "14 March 2016" are all valid — the precision
 * shown is whatever the data actually supports rather than inventing a day.
 *
 * Returns '' when there is no year, since a month without a year says nothing.
 */
export function publicationDate(book, locale = undefined) {
  if (!book?.year) return ''
  const { year, month, day } = book

  // Out-of-range parts silently roll over in the Date constructor (month 99
  // becomes a date four years later), so reject them rather than display a
  // confidently wrong date.
  if (!month || month < 1 || month > 12) return String(year)
  if (day != null && day !== 0 && (day < 1 || day > 31)) return String(year)

  // Month is 1-based in the API; the Date constructor wants 0-based.
  const date = new Date(year, month - 1, day || 1)
  if (Number.isNaN(date.getTime())) return String(year)

  return date.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    ...(day ? { day: 'numeric' } : {}),
  })
}
