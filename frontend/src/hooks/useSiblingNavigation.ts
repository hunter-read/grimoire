import { useState, useEffect, useRef, useCallback, useMemo } from 'react'

/** The fields sibling navigation reads from a media item. */
export interface SiblingItem {
  id: string
  relative_path?: string | null
  filename?: string | null
}

export interface SiblingNavigationOptions {
  /** The item on screen (null while it loads). */
  item: { relative_path?: string | null } | null | undefined
  /** Its id, from the route. */
  id: string | undefined
  /** Collection list endpoint, e.g. '/tokens'. */
  listUrl: string
  /** Key holding the array in that response. */
  listKey: string
  /** Builds the route for a sibling id. */
  detailPath: (id: string) => string
  /** react-router navigate. */
  navigate: (to: string) => unknown
  /** api.get */
  get: (url: string) => Promise<unknown>
  /** Pass the folder as a `folder` query param (default true). */
  serverFiltered?: boolean
}

export interface SiblingNavigation<T extends SiblingItem> {
  siblings: T[]
  /** Where the current item sits in `siblings`, or -1. */
  index: number
  hasPrev: boolean
  hasNext: boolean
  onPrev: () => void
  onNext: () => void
}

/** The folder an item lives in: its path minus the collection root and filename. */
export function folderPathOf(item: { relative_path?: string | null } | null | undefined): string {
  return (item?.relative_path || '').replace(/\\/g, '/').split('/').slice(1, -1).join('/')
}

/**
 * Prev/next navigation across the items sharing a folder with the one on screen.
 *
 * Every media detail view wants the same thing: the same-folder items in display
 * order, where the current one sits in that run, and a way to step either way.
 * MapDetailView and TokenDetailView each grew their own copy; extracting it is
 * what lets audio and models have the behaviour too.
 *
 * The list is fetched once per folder and reused while navigating within it, so
 * stepping through a folder costs one request rather than one per item.
 *
 * @param {object}   opts
 * @param {object}   opts.item        the item on screen (null while it loads)
 * @param {string}   opts.id          its id, from the route
 * @param {string}   opts.listUrl     collection list endpoint, e.g. '/tokens'
 * @param {string}   opts.listKey     key holding the array in that response
 * @param {Function} opts.detailPath  builds the route for a sibling id
 * @param {Function} opts.navigate    react-router navigate
 * @param {Function} opts.get         api.get
 * @param {boolean}  [opts.serverFiltered] pass the folder as a `folder` query
 *   param rather than filtering client-side. Every media list endpoint narrows
 *   by folder in SQL now (issue #221), so this is the default; fetching the
 *   whole collection to find one folder's neighbours does not scale.
 */
export default function useSiblingNavigation<T extends SiblingItem = SiblingItem>({
  item,
  id,
  listUrl,
  listKey,
  detailPath,
  navigate,
  get,
  serverFiltered = true,
}: SiblingNavigationOptions): SiblingNavigation<T> {
  const [siblings, setSiblings] = useState<T[]>([])
  const loadedFolder = useRef<string | null>(null)

  // null while the item loads, so the fetch waits for a real folder rather than
  // firing for the root and being replaced a moment later.
  const folder = item ? folderPathOf(item) : null

  useEffect(() => {
    if (folder === null || loadedFolder.current === folder) return
    loadedFolder.current = folder
    const url = serverFiltered ? `${listUrl}?folder=${encodeURIComponent(folder)}` : listUrl
    get(url)
      .then((res) => {
        const all: T[] =
          ((res as Record<string, T[] | undefined> | null | undefined) &&
            (res as Record<string, T[] | undefined>)[listKey]) ??
          []
        // The server filter admits deeper descendants, so the exact per-item
        // check runs either way — see _folder_prefix_filter on the backend.
        const sorted = all
          .filter((s) => folderPathOf(s) === folder)
          .sort((a, b) => (a.filename || '').localeCompare(b.filename || ''))
        setSiblings(sorted)
      })
      .catch(() => {
        // Leave navigation absent rather than wrong, and allow a later retry.
        loadedFolder.current = null
      })
  }, [folder, listUrl, listKey, get, serverFiltered])

  const index = useMemo(() => siblings.findIndex((s) => s.id === id), [siblings, id])
  const hasPrev = index > 0
  const hasNext = index >= 0 && index < siblings.length - 1

  const onPrev = useCallback(() => {
    if (index > 0) navigate(detailPath(siblings[index - 1].id))
  }, [index, siblings, navigate, detailPath])
  const onNext = useCallback(() => {
    if (index >= 0 && index < siblings.length - 1) navigate(detailPath(siblings[index + 1].id))
  }, [index, siblings, navigate, detailPath])

  return { siblings, index, hasPrev, hasNext, onPrev, onNext }
}
