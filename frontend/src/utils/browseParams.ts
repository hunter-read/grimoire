// The sort/filter bar's state as query parameters for the server-side browse
// endpoints (issue #221).
//
// The galleries and the system shelf used to apply these filters in the
// browser, over the whole downloaded collection. Paging moved them to the
// server; this is the one place that says how each filter is spelled there, so
// the list request and the folder-counts request for a view always agree.

import { pruneGroups, toGroups } from '../components/library/tagQuery'
import { firstValue } from '../components/library/specialFilters'
import { RECENTLY_ADDED_DAYS } from './recentlyAdded'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * A sort/filter bar's `filters` object. Read loosely: the keys a browse
 * endpoint understands are picked out, and anything else is ignored.
 */
export type BrowseFilters = Record<string, unknown>

/** Query parameter values; undefined and null are dropped. */
export type QueryParams = Record<string, string | number | boolean | null | undefined>

/**
 * `{ key: value }` as a query string, dropping undefined and null values.
 *
 * An empty string is kept: `folder=` names the root folder, which is not the
 * same request as no folder at all (the whole collection).
 */
export function toQuery(params: Record<string, unknown>): string {
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    qs.set(key, String(value))
  }
  return qs.toString()
}

/** `path` with `params` appended (`?` or `&` as needed). */
export function withQuery(path: string, params: Record<string, unknown>): string {
  const qs = toQuery(params)
  if (!qs) return path
  return `${path}${path.includes('?') ? '&' : '?'}${qs}`
}

/** The tag expression as the `tags` JSON parameter, or undefined when empty. */
function tagsParam(tags: unknown): string | undefined {
  const groups = pruneGroups(toGroups(tags))
  return groups.length ? JSON.stringify(groups) : undefined
}

/**
 * The filters every browse endpoint shares: search text, the tag expression,
 * favourites only, and recently added (sent as the cut-off time, so "recent"
 * means the same thing here as on the "new" badge).
 */
export function commonFilterParams(filters: BrowseFilters = {}, now: number = Date.now()) {
  return {
    q: ((filters.search as string | undefined) || '').trim() || undefined,
    tags: tagsParam(filters.tags),
    favorites: filters.favorites === true ? 'true' : undefined,
    added_since:
      filters.recent === true
        ? new Date(now - RECENTLY_ADDED_DAYS * DAY_MS).toISOString()
        : undefined,
  }
}

/** The system shelf's filters: the shared ones plus its own select filters. */
export function bookFilterParams(filters: BrowseFilters = {}, now: number = Date.now()) {
  return {
    ...commonFilterParams(filters, now),
    explicit: filters.explicit === undefined ? undefined : String(filters.explicit),
    genre: (firstValue(filters.genres) as string | undefined) || undefined,
    product_code: (filters.productCode as string | undefined) || undefined,
  }
}

/**
 * A stable string for "these filters and this order", for resetting paged lists
 * when either changes. Built from the filter state rather than the parameters,
 * so the recent filter's moving cut-off does not count as a change.
 */
export function browseKey(
  filters: BrowseFilters = {},
  sort: string = '',
  order: string = ''
): string {
  const { search, tags, favorites, recent, explicit, genres, productCode } = filters
  return JSON.stringify([
    ((search as string | undefined) || '').trim(),
    pruneGroups(toGroups(tags)),
    favorites === true,
    recent === true,
    explicit,
    firstValue(genres) || '',
    productCode || '',
    sort,
    order,
  ])
}
