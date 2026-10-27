// Shared helpers for the metadata editor components (issue #202).
import type { Schema } from '../../api'

/** One editable link row; either part may be blank while the user types. */
export type LinkRow = Schema<'LinkEntry'>

/** The fields of a genre lookup row (`GenreOut`) the tree is built from. */
export interface GenreLookupRow {
  id: string
  name: string
  parent_id?: string | null
  sort_order?: number
}

/** A genre placed in the tiered dropdown: children follow their parent. */
export interface GenreTreeNode {
  id: string
  name: string
  depth: number
}

/** Drop links with neither a label nor a URL (used before saving). */
export function cleanLinks<T extends LinkRow>(links: T[] | null | undefined): T[] {
  return (links || []).filter((l) => (l.label || '').trim() || (l.url || '').trim())
}

/** Ensure a link list has at least one (blank) row for editing. */
export function linksForEditing<T extends LinkRow>(
  links: T[] | null | undefined
): (T | { label: string; url: string })[] {
  return links && links.length ? links : [{ label: '', url: '' }]
}

/**
 * Build a tiered, ordered list of genres from the flat lookup rows. Each entry
 * is { id, name, depth } with children following their parent, so a dropdown
 * can indent by depth.
 */
export function buildGenreTree(genres: GenreLookupRow[]): GenreTreeNode[] {
  const byParent = new Map<string, GenreLookupRow[]>()
  for (const g of genres) {
    const key = g.parent_id || '__root__'
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(g)
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name))
  }
  const out: GenreTreeNode[] = []
  const walk = (parentKey: string, depth: number) => {
    for (const g of byParent.get(parentKey) || []) {
      out.push({ id: g.id, name: g.name, depth })
      walk(g.id, depth + 1)
    }
  }
  walk('__root__', 0)
  return out
}
