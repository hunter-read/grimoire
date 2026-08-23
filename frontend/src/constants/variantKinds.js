/**
 * The variant vocabulary, mirroring ``backend/models/variants.py``.
 *
 * Order is review order rather than the backend's set order: the kinds a user
 * reaches for most often when resolving duplicates come first, and `other` sits
 * last as the fallback. Labels live in i18n under `variants.kind.*`.
 *
 * Kept in sync by hand — the list is closed and changes rarely, and fetching it
 * would cost a round trip before the picker could render.
 */
export const VARIANT_KINDS = [
  'version',
  'printer-friendly',
  'form-fillable',
  'black-and-white',
  'spreads',
  'single-page',
  'gridded',
  'gridless',
  'other',
]
