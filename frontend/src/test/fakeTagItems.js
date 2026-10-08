// The tags view's paged item endpoints, answered from a whole-tag description
// (issue #221).
//
// `/tags/{t}/items` used to return every item carrying a tag, and the tests
// describe a tag that way: `{ internal, display, category, items, folders }`,
// each folder with its `items`. The view now asks for a summary (per-type
// counts, folders with counts) and then pages each section and folder; these
// answer those requests from the same description.

import { loadedPages } from './shelfFixtures'
import { folderListKey, typeListKey } from '../components/tags/TagTypeSection'

const folderKey = (g) => g.key ?? g.path

/** `tags.items(internal, type, { limit, offset })` from a whole-tag `detail`. */
export function pagedTagItems(detail, type, { limit, offset = 0 } = {}) {
  return Promise.resolve(detail).then((d) => {
    const items = d?.items || []
    const scoped = type ? items.filter((i) => i.item_type === type) : items
    const counts = {}
    for (const i of scoped) counts[i.item_type] = (counts[i.item_type] || 0) + 1
    const end = limit === undefined ? undefined : offset + limit
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
    }
  })
}

/** `tags.folderItems(internal, type, folder, { limit, offset })` from `detail`. */
export function pagedFolderItems(detail, type, folder, { limit = 100, offset = 0 } = {}) {
  return Promise.resolve(detail).then((d) => {
    const group = (d?.folders || []).find(
      (g) => g.resource_type === type && folderKey(g) === folder
    )
    const items = group?.items || []
    return { total: items.length, items: items.slice(offset, offset + limit) }
  })
}

/**
 * Component props for a whole-tag `detail`: the summary TagDetail takes, and
 * the paged lists every section and folder reads, all fully loaded.
 */
export function tagDetailProps(detail) {
  const items = detail.items || []
  const counts = {}
  const lists = {}
  for (const i of items) {
    counts[i.item_type] = (counts[i.item_type] || 0) + 1
    lists[typeListKey(i.item_type)] = [...(lists[typeListKey(i.item_type)] || []), i]
  }
  const folders = (detail.folders || []).map((g) => {
    lists[folderListKey(g.resource_type, folderKey(g))] = g.items || []
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
