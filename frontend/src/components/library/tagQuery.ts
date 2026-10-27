// Tag filtering as a small boolean expression rather than one flat list.
//
// A flat multi-select can only say "all of these" or "any of these" — never
// `Building AND (store OR shop)`. The filter state therefore holds a list of
// groups: tags are OR'd *within* a group and every group must match, so one
// group per AND term and the alternatives listed inside it. A group is either
// an `include` ("any of") or an `exclude` ("none of"), which covers negation
// without a second nesting level.
//
//   [{ mode: 'include', tags: ['Building'] },
//    { mode: 'include', tags: ['store', 'shop'] },
//    { mode: 'exclude', tags: ['ruined'] }]
//     => Building AND (store OR shop) AND NOT ruined
//
// The `__grim:none__` / `__grim:any__` sentinels stay usable inside a group and
// keep meaning "the item has no tags at all" / "has at least one tag", which is
// why they are evaluated against the whole field rather than group-by-group.

import { FILTER_ANY, FILTER_NONE, isEmptyField, isSpecialFilter } from './specialFilters'

export const GROUP_INCLUDE = 'include'
export const GROUP_EXCLUDE = 'exclude'

/** An empty group, ready to be filled in by the editor. */
export const emptyGroup = (mode = GROUP_INCLUDE) => ({ mode, tags: [] })

/**
 * Normalise whatever sits in `filters.tags` into a group list.
 *
 * Saved presets (and the inline tag chips) predate groups and store a flat
 * array of tag strings, which meant "all of these". Those are read as one
 * include group per tag so an old preset keeps filtering exactly as it did,
 * and `undefined` / `[]` become no groups at all.
 */
export const toGroups = (value) => {
  if (!value) return []
  if (Array.isArray(value)) {
    if (value.length === 0) return []
    // Groups vs. legacy flat list. Decided on the first entry that is usable at
    // all, so a stray null at the head of the array cannot make a group list
    // read as a list of tag strings (which would silently drop every group).
    const first = value.find((v) => v !== null && v !== undefined)
    if (typeof first === 'object') {
      return value
        .filter((g) => g && Array.isArray(g.tags))
        .map((g) => ({
          mode: g.mode === GROUP_EXCLUDE ? GROUP_EXCLUDE : GROUP_INCLUDE,
          tags: g.tags.filter((t) => typeof t === 'string'),
        }))
    }
    // Legacy flat list: AND of single-tag groups.
    return value
      .filter((t) => typeof t === 'string')
      .map((t) => ({ mode: GROUP_INCLUDE, tags: [t] }))
  }
  return []
}

/** Drop groups with no tags — an empty group constrains nothing. */
export const pruneGroups = (groups = []) => toGroups(groups).filter((g) => g.tags.length > 0)

/** True when the expression would filter nothing out. */
export const isEmptyQuery = (value) => pruneGroups(toGroups(value)).length === 0

/**
 * The concrete (non-sentinel) tags named anywhere in the expression.
 * Used by the inline tag chips, which highlight the tags in play and know
 * nothing about groups or sentinels.
 */
export const queryTags = (value) => {
  const out = []
  for (const g of pruneGroups(toGroups(value))) {
    for (const t of g.tags) if (!isSpecialFilter(t)) out.push(t)
  }
  return [...new Set(out)]
}

/**
 * Evaluate the expression against an item's tags.
 *
 * @param value   the raw `filters.tags` (groups, legacy flat list, or empty)
 * @param field   the item's tags — for media this is the *effective* set
 *                (the item's own tags plus every parent folder's)
 * @returns true when the item passes
 */
export const matchesTagQuery = (value, field) => {
  const groups = pruneGroups(toGroups(value))
  if (groups.length === 0) return true
  const owned = new Set((field || []).map((t) => String(t).toLowerCase()))
  const empty = isEmptyField(field)
  // Everything inside a group is OR'd, sentinels included — so each term is
  // tested on its own rather than through splitSpecial, which ANDs them (two
  // sentinels in one group are alternatives here, not a contradiction).
  const termHit = (term) => {
    if (term === FILTER_NONE) return empty
    if (term === FILTER_ANY) return !empty
    return owned.has(String(term).toLowerCase())
  }
  for (const group of groups) {
    const hit = group.tags.some(termHit)
    if (group.mode === GROUP_EXCLUDE ? hit : !hit) return false
  }
  return true
}

/**
 * Toggle a single tag, for the inline chip row which has no group UI.
 *
 * Removing hits the tag wherever it appears. Adding appends a new single-tag
 * include group, which ANDs it onto whatever is already there — the same
 * "narrow it down by one more tag" behaviour the chips had before groups
 * existed, and it never rewrites a group the user built in the modal.
 */
export const toggleQueryTag = (value, tag) => {
  const groups = pruneGroups(toGroups(value))
  const lower = tag.toLowerCase()
  const present = groups.some(
    (g) => g.mode === GROUP_INCLUDE && g.tags.some((t) => t.toLowerCase() === lower)
  )
  if (present) {
    return groups
      .map((g) => ({ ...g, tags: g.tags.filter((t) => t.toLowerCase() !== lower) }))
      .filter((g) => g.tags.length > 0)
  }
  return [...groups, { mode: GROUP_INCLUDE, tags: [tag] }]
}

/**
 * A short human-readable rendering of the expression, e.g.
 * `Building AND (store OR shop) AND NOT (ruined)`. `labels` supplies the
 * translated joiners so the summary reads correctly in every locale.
 */
export const describeQuery = (value, labels = {}) => {
  const { and = 'AND', or = 'OR', not = 'NOT', none = 'No tags', any = 'Any tags' } = labels
  const groups = pruneGroups(toGroups(value))
  if (groups.length === 0) return ''
  const term = (t) => (t === FILTER_NONE ? none : t === FILTER_ANY ? any : t)
  return groups
    .map((g) => {
      const inner = g.tags.map(term).join(` ${or} `)
      // Excluded groups are always parenthesised so the NOT visibly covers the
      // whole group rather than reading as if it bound only the first tag.
      if (g.mode === GROUP_EXCLUDE) return `${not} (${inner})`
      return g.tags.length > 1 ? `(${inner})` : inner
    })
    .join(` ${and} `)
}
