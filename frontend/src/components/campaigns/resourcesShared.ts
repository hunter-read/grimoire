import type { CSSProperties } from 'react'
import type { IconType } from 'react-icons'
import { LuBookOpen, LuMap, LuUser, LuMusic, LuBox, LuFile } from 'react-icons/lu'

export interface ResourceTypeIcon {
  Icon: IconType
  color: string
}

/** The fields every resource-like row (a search hit, a linked resource) carries. */
export interface ResourceLike {
  resource_type: string
  resource_id: string
}

/** A resource the folder tree can file: a name plus a "/"-joined folder path. */
export interface TreeResource extends ResourceLike {
  name: string
  subtitle?: string | null
}

/** One folder of `buildFolderTree`'s result. */
export interface FolderNode<R extends TreeResource = TreeResource> {
  key: string
  name: string
  path: string
  folders: FolderNode<R>[]
  items: R[]
}

interface BuildNode<R> {
  name: string
  path: string
  folders: Map<string, BuildNode<R>>
  items: R[]
}

// Keyed by any resource_type string, so a lookup of an unknown type is undefined.
export const TYPE_ICONS: Record<string, ResourceTypeIcon> = {
  book: { Icon: LuBookOpen, color: 'var(--type-book)' },
  map: { Icon: LuMap, color: 'var(--type-map)' },
  token: { Icon: LuUser, color: 'var(--type-token)' },
  audio: { Icon: LuMusic, color: 'var(--type-audio)' },
  model: { Icon: LuBox, color: 'var(--type-model)' },
  file: { Icon: LuFile, color: 'var(--type-file)' },
}

// Type tabs offered by the resource picker, in display order. No "all" tab —
// one type at a time keeps the folder tree readable; "file" resources are
// campaign uploads, not library items, so they aren't pickable here.
export const PICKER_TYPES: readonly string[] = ['book', 'map', 'token', 'audio', 'model']

/** Stable key for a resource across every picker/panel. */
export function resourceKey(r: ResourceLike): string {
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
export function buildFolderTree<R extends TreeResource>(
  resources: readonly R[],
  ungroupedLabel: string,
  pinName = ''
): FolderNode<R>[] {
  const root: Pick<BuildNode<R>, 'folders' | 'items'> = { folders: new Map(), items: [] }

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
      node = node.folders.get(seg)!
    }
    node.items.push(r)
  }

  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)
  const toArray = (
    node: Pick<BuildNode<R>, 'folders'>,
    typePrefix: string,
    sort: (a: BuildNode<R>, b: BuildNode<R>) => number
  ): FolderNode<R>[] =>
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
    ? (a: BuildNode<R>, b: BuildNode<R>) => {
        if (a.name === pin && b.name !== pin) return -1
        if (b.name === pin && a.name !== pin) return 1
        return byName(a, b)
      }
    : byName

  return toArray(root, resources[0]?.resource_type || '', topSort)
}

/** Every resource contained by a tree node (its own items plus descendants). */
export function nodeResources<R extends TreeResource>(node: FolderNode<R>): R[] {
  const out = [...node.items]
  for (const f of node.folders) out.push(...nodeResources(f))
  return out
}

export const RESOURCE_NAV: Record<string, ((id: string) => string) | undefined> = {
  book: (id: string) => `/library/book/${id}`,
  map: (id: string) => `/maps/${id}`,
  token: (id: string) => `/tokens/${id}`,
  audio: (id: string) => `/audio/${id}`,
  model: (id: string) => `/models/${id}`,
}

// Visibility selector order: public, then private, then GM-only.
export const VISIBILITY_OPTIONS = ['public', 'private', 'gm']

export const selectStyle: CSSProperties = {
  appearance: 'auto',
  fontSize: 12,
  padding: '3px 6px',
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text-dim)',
  cursor: 'pointer',
}
