// Shared helpers for the metadata editor components (issue #202).

/** Drop links with neither a label nor a URL (used before saving). */
export function cleanLinks(links) {
  return (links || []).filter((l) => (l.label || '').trim() || (l.url || '').trim())
}

/** Ensure a link list has at least one (blank) row for editing. */
export function linksForEditing(links) {
  return links && links.length ? links : [{ label: '', url: '' }]
}

/**
 * Build a tiered, ordered list of genres from the flat lookup rows. Each entry
 * is { id, name, depth } with children following their parent, so a dropdown
 * can indent by depth.
 */
export function buildGenreTree(genres) {
  const byParent = new Map()
  for (const g of genres) {
    const key = g.parent_id || '__root__'
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key).push(g)
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name))
  }
  const out = []
  const walk = (parentKey, depth) => {
    for (const g of byParent.get(parentKey) || []) {
      out.push({ id: g.id, name: g.name, depth })
      walk(g.id, depth + 1)
    }
  }
  walk('__root__', 0)
  return out
}
