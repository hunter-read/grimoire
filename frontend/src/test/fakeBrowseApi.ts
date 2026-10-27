// An in-memory stand-in for the server-side browse endpoints (issue #221), for
// view tests.
//
// The galleries and the system shelf used to receive a whole collection and
// filter it in the browser, so their tests handed `api.get` a fixed list and
// checked what the view hid. Filtering now happens on the server; this answers
// the list, `/groups` and folder endpoints over a test's items with the same
// meanings, so those tests keep asserting on what the user sees.

import { matchesTagQuery } from '../components/library/tagQuery'

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function parse(url) {
  const [path, query = ''] = url.split('?')
  return { path, params: new URLSearchParams(query) }
}

/** An item's folder below the collection dir: "maps/A/B/x.png" → "A/B". */
export function mediaFolder(item) {
  return (item.relative_path || '').replace(/\\/g, '/').split('/').slice(1, -1).join('/')
}

function ancestors(folder) {
  const parts = folder ? folder.split('/') : []
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'))
}

function pageOf(rows, params) {
  const offset = Number(params.get('offset') || 0)
  const limit = params.has('limit') ? Number(params.get('limit')) : rows.length
  return rows.slice(offset, offset + limit)
}

function sorter(sort, order) {
  const dir = order === 'desc' ? -1 : 1
  const byName = (a, b) => dir * collator.compare(a.filename || '', b.filename || '')
  if (sort === 'size')
    return (a, b) => dir * ((a.file_size || 0) - (b.file_size || 0)) || byName(a, b)
  if (sort === 'title')
    return (a, b) =>
      dir * collator.compare(a.title || a.filename || '', b.title || b.filename || '')
  if (sort === 'path')
    return (a, b) => collator.compare(mediaFolder(a), mediaFolder(b)) || byName(a, b)
  return byName
}

/**
 * `api.get` for one media gallery.
 *
 * @param {object} opts
 * @param {string} opts.listUrl      e.g. '/maps'
 * @param {string} opts.collection   the response key, e.g. 'maps'
 * @param {string} opts.foldersUrl   e.g. '/map-folders'
 * @param {Array}  opts.items        the collection
 * @param {Array}  [opts.folders]    `{ path, tags }` folder-tag rows
 * @param {Array}  [opts.frameFolders]
 * @param {Function} [opts.isFavorite] `(id) => bool` for `favorites=true`
 * @param {Function} [opts.fallback] answers any other URL
 */
export function fakeMediaGet({
  listUrl,
  collection,
  foldersUrl,
  items,
  folders = [],
  frameFolders,
  isFavorite = () => false,
  fallback = () => Promise.resolve({}),
}) {
  const folderTags = Object.fromEntries(folders.map((f) => [f.path, f.tags || []]))
  const effective = (item) => [
    ...(item.tags || []),
    ...ancestors(mediaFolder(item)).flatMap((p) => folderTags[p] || []),
  ]
  const filtered = (params) => {
    const q = (params.get('q') || '').toLowerCase()
    const tags = params.get('tags') ? JSON.parse(params.get('tags')) : null
    const since = params.get('added_since')
    return items.filter((item) => {
      const tagList = effective(item)
      if (q) {
        const hay = [item.filename, item.title, mediaFolder(item), ...tagList]
          .join('\u0000')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (tags && !matchesTagQuery(tags, tagList)) return false
      if (params.get('favorites') === 'true' && !isFavorite(item.id)) return false
      if (since && !(item.added_at && Date.parse(item.added_at) >= Date.parse(since))) return false
      return true
    })
  }

  return (url) => {
    const { path, params } = parse(url)
    if (path === foldersUrl) {
      return Promise.resolve({ folders, ...(frameFolders ? { frame_folders: frameFolders } : {}) })
    }
    if (path === `${listUrl}/groups`) {
      const counts = new Map()
      for (const item of filtered(params)) {
        const folder = mediaFolder(item)
        counts.set(folder, (counts.get(folder) || 0) + 1)
      }
      const groups = [...counts.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([p, count]) => ({ path: p, count }))
      return Promise.resolve({ total: groups.reduce((n, g) => n + g.count, 0), groups })
    }
    if (path === listUrl) {
      let rows = filtered(params)
      if (params.has('folder')) rows = rows.filter((i) => mediaFolder(i) === params.get('folder'))
      rows = [...rows].sort(sorter(params.get('sort'), params.get('order')))
      return Promise.resolve({ total: rows.length, [collection]: pageOf(rows, params) })
    }
    return fallback(url)
  }
}

/** A book's subfolder below its category directory, for a given depth. */
function bookFolder(book, depth) {
  const parts = (book.relative_path || '').replace(/\\/g, '/').split('/')
  return parts.length > depth + 2 ? parts.slice(depth + 1, -1).join('/') : ''
}

function bookDir(book) {
  return (book.relative_path || '').replace(/\\/g, '/').split('/').slice(0, -1).join('/')
}

/**
 * `api.get` for SystemDetailView: the summary (`system`, sent without books),
 * `/book-groups`, `/books` and `/book-facets` over `books`.
 */
export function fakeShelfGet({
  system,
  books,
  isFavorite = () => false,
  fallback = () => Promise.resolve({}),
}) {
  const depth = Number.isInteger(system.category_depth)
    ? system.category_depth
    : system.parent_id
      ? 3
      : 2
  const base = `/systems/${system.id}`
  const filtered = (params) => {
    const q = (params.get('q') || '').toLowerCase()
    const tags = params.get('tags') ? JSON.parse(params.get('tags')) : null
    const genre = (params.get('genre') || '').toLowerCase()
    const code = (params.get('product_code') || '').toUpperCase()
    return books.filter((b) => {
      if (q && !(b.title || '').toLowerCase().includes(q)) return false
      if (tags && !matchesTagQuery(tags, b.tags)) return false
      if (params.get('favorites') === 'true' && !isFavorite(b.id)) return false
      if (params.has('explicit') && String(!!b.is_explicit) !== params.get('explicit')) return false
      if (genre && !(b.genres || []).some((g) => g.toLowerCase() === genre)) return false
      if (code && !(b.product_code || '').toUpperCase().startsWith(code)) return false
      const since = params.get('added_since')
      if (since && !(b.added_at && Date.parse(b.added_at) >= Date.parse(since))) return false
      return true
    })
  }
  const sortBooks = (rows, params) => {
    const sort = params.get('sort') || 'title'
    const dir = params.get('order') === 'desc' ? -1 : 1
    const byTitle = (a, b) => dir * collator.compare(a.title || '', b.title || '')
    const field = { size: 'file_size' }[sort] || sort
    if (sort === 'title') return [...rows].sort(byTitle)
    return [...rows].sort((a, b) => {
      const va = a[field]
      const vb = b[field]
      if (va == null || vb == null) return va == null ? (vb == null ? byTitle(a, b) : 1) : -1
      return dir * (va < vb ? -1 : va > vb ? 1 : 0) || byTitle(a, b)
    })
  }

  return (url) => {
    const { path, params } = parse(url)
    if (path === base) {
      // The server reads the system's own folder off any book's path.
      const ref = books.find((b) => b.relative_path)
      const parts = ref ? ref.relative_path.replace(/\\/g, '/').split('/') : []
      const scope = parts.length > depth ? parts.slice(0, depth).join('/') : null
      return Promise.resolve({ scope_path: scope, ...system, books: [] })
    }
    if (path === `${base}/book-facets`) {
      return Promise.resolve({
        categories: [...new Set(books.map((b) => b.category).filter(Boolean))].sort(),
        genres: [...new Set(books.flatMap((b) => b.genres || []))].sort(),
        product_code_prefixes: [],
        tags: [...new Set(books.flatMap((b) => b.tags || []))].sort(),
      })
    }
    if (path === `${base}/book-groups`) {
      const rows = new Map()
      for (const b of filtered(params)) {
        const key = `${b.category || 'core'}\u0000${bookDir(b)}`
        const row = rows.get(key) || {
          category: b.category || 'core',
          path: bookFolder(b, depth),
          dir: bookDir(b),
          count: 0,
          first: null,
        }
        row.count += 1
        rows.set(key, row)
      }
      const groups = [...rows.values()]
      return Promise.resolve({ total: groups.reduce((n, g) => n + g.count, 0), groups })
    }
    if (path === `${base}/books`) {
      let rows = filtered(params)
      if (params.has('category')) {
        rows = rows.filter((b) => (b.category || 'core') === params.get('category'))
      }
      if (params.has('folder'))
        rows = rows.filter((b) => bookFolder(b, depth) === params.get('folder'))
      rows = sortBooks(rows, params)
      return Promise.resolve({ total: rows.length, books: pageOf(rows, params) })
    }
    return fallback(url)
  }
}
