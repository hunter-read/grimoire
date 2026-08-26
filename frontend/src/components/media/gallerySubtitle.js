/**
 * Subtitle text for a gallery header.
 *
 * With no filters narrowing the view the plain "{{count}} maps in your
 * collection" reading is correct and stays. Once filters hide something, the
 * bare count reads as the size of the whole collection, so it switches to
 * "Displaying x of y" — where `total` is only ever the rows the list endpoint
 * returned for this user, never a library-wide figure.
 */
export default function gallerySubtitle(t, prefix, { count, total }) {
  return count === total
    ? t(`${prefix}.subtitle`, { count })
    : t(`${prefix}.subtitleFiltered`, { count, total })
}
