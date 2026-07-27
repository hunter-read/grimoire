// Client-side sort/filter for the systems list, matching the backend keys
// (name | book_count | page_count | year) and filters (genre, family, explicit,
// tags, favorites).

const has = (field, wanted) => {
  if (!wanted) return true
  const w = String(wanted).toLowerCase()
  if (Array.isArray(field)) return field.some((v) => String(v).toLowerCase() === w)
  return String(field || '').toLowerCase() === w
}

/**
 * Filter + sort systems.
 * @param systems array of system rows
 * @param state { sort, order, filters }
 * @param opts { isFavorite: (id) => bool } for the favorites filter
 */
export function applySystemSortFilter(systems, state, opts = {}) {
  const { sort = 'name', order = 'asc', filters = {} } = state || {}
  const { isFavorite } = opts
  const wantTags = Array.isArray(filters.tags) ? filters.tags.map((tg) => tg.toLowerCase()) : []
  const wantDice = Array.isArray(filters.dice) ? filters.dice.map((d) => d.toLowerCase()) : []
  const search = (filters.search || '').trim().toLowerCase()
  let out = systems.filter((s) => {
    if (search && !(s.name || '').toLowerCase().includes(search)) return false
    if (filters.explicit !== undefined && Boolean(s.is_explicit) !== filters.explicit) return false
    if (filters.genre && !has(s.genres, filters.genre)) return false
    if (filters.family && !has(s.system_family, filters.family)) return false
    if (filters.parent_system && !has(s.parent_system, filters.parent_system)) return false
    if (filters.edition && !has(s.edition, filters.edition)) return false
    if (filters.favorites === true && isFavorite && !isFavorite(s.id)) return false
    if (wantTags.length) {
      const tags = (s.tags || []).map((tg) => String(tg).toLowerCase())
      if (!wantTags.every((tg) => tags.includes(tg))) return false
    }
    if (wantDice.length) {
      const dice = (s.dice_materials || []).map((d) => String(d).toLowerCase())
      if (!wantDice.every((d) => dice.includes(d))) return false
    }
    return true
  })
  const dir = order === 'desc' ? -1 : 1
  const cmp = {
    name: (a, b) => a.name.localeCompare(b.name),
    book_count: (a, b) => (a.book_count || 0) - (b.book_count || 0),
    page_count: (a, b) => (a.total_page_count || 0) - (b.total_page_count || 0),
    year: (a, b) => {
      const ay = a.year == null ? Infinity : a.year
      const by = b.year == null ? Infinity : b.year
      return ay - by
    },
  }
  const fn = cmp[sort] || cmp.name
  out = [...out].sort((a, b) => dir * fn(a, b))
  return out
}
