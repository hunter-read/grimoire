import { LuBookOpen, LuMap, LuUser, LuMusic, LuFile } from 'react-icons/lu'

export const TYPE_ICONS = {
  book: { Icon: LuBookOpen, color: '#a78bfa' },
  map: { Icon: LuMap, color: '#60a5fa' },
  token: { Icon: LuUser, color: '#34d399' },
  audio: { Icon: LuMusic, color: '#f0a868' },
  file: { Icon: LuFile, color: '#e0b341' },
}

// Type tabs offered by the resource picker, in display order. No "all" tab —
// one type at a time keeps the folder tree readable; "file" resources are
// campaign uploads, not library items, so they aren't pickable here.
export const PICKER_TYPES = ['book', 'map', 'token', 'audio']

/** Stable key for a resource across every picker/panel. */
export function resourceKey(r) {
  return `${r.resource_type}:${r.resource_id}`
}

/**
 * Build a nested folder tree from a flat list of resources, splitting each
 * item's `subtitle` (a "/"-joined folder path) into arbitrarily deep folders.
 *
 * Systems own categories, categories own subcategories, and so on — the same
 * structure the library browses by. Items with an empty subtitle fall into a
 * single top-level `ungroupedLabel` bucket.
 *
 * Returns an array of nodes, each: { key, name, path, folders, items }, sorted
 * with folders before loose items and alphabetically within a level.
 *
 * `pinName` pins a matching *top-level* folder to the front of the list (the
 * rest stay alphabetical) — used to float the campaign's own game system above
 * the other systems in the book tree.
 */
export function buildFolderTree(resources, ungroupedLabel, pinName = '') {
  const root = { folders: new Map(), items: [] }

  for (const r of resources) {
    const segments = (r.subtitle || '')
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean)
    if (segments.length === 0) {
      // No folder path: group under the shared "ungrouped" bucket so loose
      // items still get a header instead of floating at the root.
      segments.push(ungroupedLabel)
    }
    let node = root
    let path = ''
    for (const seg of segments) {
      path = path ? `${path}/${seg}` : seg
      if (!node.folders.has(seg)) {
        node.folders.set(seg, { name: seg, path, folders: new Map(), items: [] })
      }
      node = node.folders.get(seg)
    }
    node.items.push(r)
  }

  const byName = (a, b) => a.name.localeCompare(b.name)
  const toArray = (node, typePrefix, sort) =>
    [...node.folders.values()].sort(sort).map((f) => ({
      key: `${typePrefix}:::${f.path}`,
      name: f.name,
      path: f.path,
      folders: toArray(f, typePrefix, byName),
      items: f.items.slice().sort(byName),
    }))

  // Top level: pinned folder first (if present), then alphabetical. Deeper
  // levels are always alphabetical.
  const pin = pinName.trim()
  const topSort = pin
    ? (a, b) => {
        if (a.name === pin && b.name !== pin) return -1
        if (b.name === pin && a.name !== pin) return 1
        return byName(a, b)
      }
    : byName

  return toArray(root, resources[0]?.resource_type || '', topSort)
}

/** Every resource contained by a tree node (its own items plus descendants). */
export function nodeResources(node) {
  const out = [...node.items]
  for (const f of node.folders) out.push(...nodeResources(f))
  return out
}

export const RESOURCE_NAV = {
  book: (id) => `/library/book/${id}`,
  map: (id) => `/maps/${id}`,
  token: (id) => `/tokens/${id}`,
  audio: (id) => `/audio/${id}`,
}

// Visibility selector order: public, then private, then GM-only.
export const VISIBILITY_OPTIONS = ['public', 'private', 'gm']

export const selectStyle = {
  appearance: 'auto',
  fontSize: 12,
  padding: '3px 6px',
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text-dim)',
  cursor: 'pointer',
}
