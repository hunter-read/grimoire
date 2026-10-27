/**
 * Subtitle text for a gallery header.
 *
 * With no filters narrowing the view the plain "{{count}} maps in your
 * collection" reading is correct and stays. Once filters hide something, the
 * bare count reads as the size of the whole collection, so it switches to
 * "Displaying x of y" — where `total` is only ever the rows the list endpoint
 * returned for this user, never a library-wide figure.
 *
 * While the library is still streaming in, `count`/`total` describe only the
 * pages that have arrived, so on a large collection the number visibly climbed
 * a page at a time. Passing `loading` with the server's `available` total shows
 * that figure instead — the collection's real size, which does not change as
 * pages land — so the header reads correctly from the first page and the rest
 * of the library fills in silently below the fold.
 */
export default function gallerySubtitle(t, prefix, { count, total, loading, available }) {
  // A filter narrowing the (partial) set still has to report what it matched:
  // "Displaying x of y" stays honest mid-load because both halves grow together.
  if (loading && count === total) {
    return t(`${prefix}.subtitle`, { count: Math.max(available || 0, total) })
  }
  return count === total
    ? t(`${prefix}.subtitle`, { count })
    : t(`${prefix}.subtitleFiltered`, { count, total })
}
