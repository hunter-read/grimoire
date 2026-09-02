/**
 * The variant vocabulary, mirroring ``backend/models/variants.py``.
 *
 * Order is review order rather than the backend's set order: the kinds a user
 * reaches for most often when resolving duplicates come first, and `other` sits
 * last as the fallback. Labels live in i18n under `variants.kind.*`.
 *
 * Kept in sync by hand — the lists are closed and change rarely, and fetching
 * them would cost a round trip before the picker could render. The mirror is
 * held to the backend by `variantKinds.test.js`, which asserts the exact
 * per-collection membership rather than deriving it.
 */

/**
 * Which kinds each collection accepts, mirroring `VARIANT_KINDS_BY_TYPE`.
 *
 * Scoped because most kinds only mean something for one collection: a gridless
 * token or a form-fillable audio track is not a distinction a user can make,
 * and the API rejects it. Each list is already in review order, so a picker can
 * render it as-is.
 */
export const VARIANT_KINDS_BY_TYPE = {
  book: [
    'version',
    'printer-friendly',
    'form-fillable',
    'black-and-white',
    'spreads',
    'single-page',
    'other',
  ],
  map: [
    'version',
    'gridded',
    'gridless',
    'universal-vtt',
    'video',
    'image',
    'printer-friendly',
    'black-and-white',
    'other',
  ],
  token: ['version', 'color-variation', 'black-and-white', 'other'],
  audio: ['version', 'remix', 'slowed', 'sped-up', 'other'],
}

/**
 * Every kind any collection accepts, in review order, deduplicated.
 *
 * The fallback for a caller with no resource type in hand. Prefer
 * `kindsFor(resourceType)` wherever the collection is known — offering a token
 * a kind the API will reject is a dead end the user only discovers on submit.
 *
 * `other` is pulled to the end: flattening puts it wherever the first list
 * happened to end, and it has to stay last to read as the fallback it is.
 */
export const VARIANT_KINDS = [
  ...new Set(
    ['book', 'map', 'token', 'audio']
      .flatMap((type) => VARIANT_KINDS_BY_TYPE[type])
      .filter((kind) => kind !== 'other')
  ),
  'other',
]

/**
 * The kinds `resourceType` accepts, plus `current` when the row already carries
 * a kind that collection no longer offers.
 *
 * That second part matters for rows linked before the vocabulary was scoped: a
 * token marked `printer-friendly` must still show what it is, and the select
 * must hold that value, or mounting the picker would silently display — and on
 * save, write — a different kind than the row has. The backend allows exactly
 * this one exemption too (see `validate_kind`).
 */
export function kindsFor(resourceType, current = '') {
  const kinds = VARIANT_KINDS_BY_TYPE[resourceType] || VARIANT_KINDS
  if (current && !kinds.includes(current)) return [...kinds, current]
  return kinds
}
