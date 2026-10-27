// The tags view's paged item endpoints, answered from a whole-tag description
// (issue #221).
//
// `/tags/{t}/items` used to return every item carrying a tag, and the tests
// describe a tag that way: `{ internal, display, category, items, folders }`,
// each folder with its `items`. The view now asks for a summary (per-type
// counts, folders with counts) and then pages each section and folder; these
// answer those requests from the same description.

import type { Schema } from '../api'
import type { PagedLists } from '../hooks/usePagedLists'
import { loadedPages } from './shelfFixtures'
import { folderListKey, typeListKey } from '../components/tags/TagTypeSection'

/** One tagged item; tests add whatever fields the view reads. */
export interface FakeTagItem {
  item_type: string
  item_id?: string
}

/** A folder-tag group with its whole contents (its items need no `item_type`). */
export interface FakeTagFolder<F extends object = object> {
  resource_type: string
  path: string
  key?: string
  count?: number
  items?: F[]
}

/** A whole tag, the way the tests describe one. */
export interface FakeTagDetail<I extends FakeTagItem = FakeTagItem, F extends object = object> {
  internal?: string
  display?: string
  category?: string | null
  items?: I[]
  folders?: FakeTagFolder<F>[]
}

/** Paging arguments, as the tags API takes them. */
export interface FakePageOpts {
  limit?: number
  offset?: number
}

type FolderItemOf<D extends FakeTagDetail> = NonNullable<
  NonNullable<D['folders']>[number]['items']
>[number]

/** Anything a tag's paged lists can hold: its own items or a folder's. */
type ItemOf<D extends FakeTagDetail> = NonNullable<D['items']>[number] | FolderItemOf<D>

const folderKey = (g: FakeTagFolder): string => g.key ?? g.path

/** `tags.items(internal, type, { limit, offset })` from a whole-tag `detail`. */
export function pagedTagItems(
  detail: FakeTagDetail | null | undefined | PromiseLike<FakeTagDetail | null | undefined>,
  type: string | null | undefined,
  { limit, offset = 0 }: FakePageOpts = {}
): Promise<Schema<'TagItemsResponse'>> {
  return Promise.resolve(detail).then((d) => {
    const items = d?.items || []
    const scoped = type ? items.filter((i) => i.item_type === type) : items
    const counts: Record<string, number> = {}
    for (const i of scoped) counts[i.item_type] = (counts[i.item_type] || 0) + 1
    const end = limit === undefined ? undefined : offset + limit
    // A fake: fields the test's description leaves out come back undefined.
    return {
      internal: d?.internal,
      display: d?.display,
      category: d?.category,
      counts,
      total: scoped.length,
      items: limit === 0 ? [] : scoped.slice(offset, end),
      folders: (d?.folders || [])
        .filter((g) => !type || g.resource_type === type)
        .map((g) => ({
          resource_type: g.resource_type,
          path: g.path,
          key: folderKey(g),
          count: g.count ?? (g.items || []).length,
        })),
    } as unknown as Schema<'TagItemsResponse'>
  })
}

/** `tags.folderItems(internal, type, folder, { limit, offset })` from `detail`. */
export function pagedFolderItems<D extends FakeTagDetail = FakeTagDetail>(
  detail: D | null | undefined | PromiseLike<D | null | undefined>,
  type: string,
  folder: string,
  { limit = 100, offset = 0 }: FakePageOpts = {}
): Promise<{ total: number; items: FolderItemOf<D>[] }> {
  return Promise.resolve(detail).then((d) => {
    const group = (d?.folders || []).find(
      (g) => g.resource_type === type && folderKey(g) === folder
    )
    const items = (group?.items || []) as FolderItemOf<D>[]
    return { total: items.length, items: items.slice(offset, offset + limit) }
  })
}

/**
 * Component props for a whole-tag `detail`: the summary TagDetail takes, and
 * the paged lists every section and folder reads, all fully loaded.
 */
export function tagDetailProps<D extends FakeTagDetail>(
  detail: D
): {
  detail: Omit<D, 'folders'> & {
    counts: Record<string, number>
    total: number
    folders: Schema<'TaggedFolder'>[]
  }
  pages: PagedLists<ItemOf<D>>
  onLoad: (key: string) => void
} {
  const items: NonNullable<D['items']> = detail.items || []
  const counts: Record<string, number> = {}
  const lists: Record<string, ItemOf<D>[]> = {}
  for (const i of items) {
    counts[i.item_type] = (counts[i.item_type] || 0) + 1
    lists[typeListKey(i.item_type)] = [...(lists[typeListKey(i.item_type)] || []), i]
  }
  const folders = (detail.folders || []).map((g): Schema<'TaggedFolder'> => {
    lists[folderListKey(g.resource_type, folderKey(g))] = (g.items || []) as ItemOf<D>[]
    return {
      resource_type: g.resource_type,
      path: g.path,
      key: folderKey(g),
      count: g.count ?? (g.items || []).length,
    }
  })
  return {
    detail: { ...detail, counts, total: items.length, folders },
    pages: loadedPages(lists),
    onLoad: () => {},
  }
}
