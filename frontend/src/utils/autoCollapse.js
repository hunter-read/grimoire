// Past this many items, a page's collapsible groups start collapsed: on a long
// page the headers are the useful overview, and the user expands what they
// want instead of scrolling past everything else to reach it.
export const AUTO_COLLAPSE_THRESHOLD = 25

// On a long system page, core stays open when it is only a handful of books -
// it is what most visitors came for, and a few rows cost little room.
export const CORE_OPEN_MAX = 5

/**
 * Whether a page holding `count` items across `groupCount` collapsible groups
 * should start with them collapsed. A lone group is left open: collapsing the
 * only thing on the page just adds a click before anything shows.
 */
export function shouldAutoCollapse(count, groupCount = Infinity) {
  return count > AUTO_COLLAPSE_THRESHOLD && groupCount > 1
}

/**
 * The book categories a system page starts with collapsed, given all of its
 * books. Every category collapses on a long page, except a small core.
 */
export function defaultCollapsedCategories(books) {
  const counts = {}
  for (const b of books || []) {
    const cat = b.category || 'core'
    counts[cat] = (counts[cat] || 0) + 1
  }
  return defaultCollapsedFromCounts(counts)
}

/**
 * `defaultCollapsedCategories` from per-category counts rather than the books
 * themselves - what a paged shelf has before any book loads (issue #221).
 */
export function defaultCollapsedFromCounts(counts = {}) {
  const cats = Object.keys(counts)
  const total = cats.reduce((n, c) => n + counts[c], 0)
  if (!shouldAutoCollapse(total, cats.length)) return new Set()
  const keepCore = (counts.core || 0) <= CORE_OPEN_MAX
  return new Set(cats.filter((cat) => !(keepCore && cat === 'core')))
}
