// A browse view's sort and filters as query parameters, so the address bar says
// what the page shows: a filtered view can be bookmarked, shared, and reloaded,
// and Back returns to the previous filtering.
//
// Spelled to read plainly - `?sort=added_at&order=desc&q=cave&favorites=true` -
// with one parameter per filter. A filter that is not a plain string or
// boolean (the grouped tag expression, a multi-value select) is written as
// JSON. Parameters a view owns for other reasons (`folder`) are left alone.

import type { SortFilterState } from '../components/library/FilterModal'

// Query parameters that are not sort/filter state.
const RESERVED = new Set(['folder'])

const isEmpty = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0)

/** A filter value as one parameter value. */
function encodeValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

/** One parameter value back as the filter value it was written from. */
function decodeValue(raw: string): unknown {
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (raw.startsWith('[') || raw.startsWith('{')) {
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }
  return raw
}

/**
 * `state` as query parameters. The sort and order are left out while they are
 * `defaults`', so an untouched view keeps a clean address.
 */
export function encodeSortFilter(
  state: Partial<SortFilterState>,
  defaults: Partial<SortFilterState> = {}
): [string, string][] {
  const out: [string, string][] = []
  if (state.sort && state.sort !== defaults.sort) out.push(['sort', state.sort])
  if (state.order && state.order !== defaults.order) out.push(['order', state.order])
  const filters = (state.filters || {}) as Record<string, unknown>
  for (const key of Object.keys(filters).sort()) {
    const value = filters[key]
    if (isEmpty(value)) continue
    const name = key === 'search' ? 'q' : key
    if (RESERVED.has(name) || name === 'sort' || name === 'order') continue
    out.push([name, encodeValue(value)])
  }
  return out
}

/**
 * The sort/filter state the parameters describe, or null when they carry none
 * (the view then starts from its saved default as usual).
 */
export function decodeSortFilter(
  params: URLSearchParams,
  defaults: SortFilterState
): SortFilterState | null {
  let found = false
  const state: SortFilterState = { ...defaults, filters: {} }
  const filters: Record<string, unknown> = {}
  for (const [name, raw] of params) {
    if (RESERVED.has(name)) continue
    found = true
    if (name === 'sort') state.sort = raw
    else if (name === 'order') state.order = raw === 'desc' ? 'desc' : 'asc'
    else filters[name === 'q' ? 'search' : name] = decodeValue(raw)
  }
  if (!found) return null
  state.filters = filters as SortFilterState['filters']
  return state
}

/** The parameters as a stable string, for "has this changed?" checks. */
export function sortFilterQuery(pairs: [string, string][]): string {
  return new URLSearchParams(pairs).toString()
}

/** `params` with its sort/filter parameters replaced by `pairs`; the rest kept. */
export function withSortFilter(
  params: URLSearchParams,
  pairs: [string, string][]
): URLSearchParams {
  const next = new URLSearchParams()
  for (const [name, value] of params) if (RESERVED.has(name)) next.append(name, value)
  for (const [name, value] of pairs) next.append(name, value)
  return next
}

/** Just the sort/filter part of `params`, as `sortFilterQuery` spells it. */
export function sortFilterPart(params: URLSearchParams): string {
  const pairs: [string, string][] = []
  for (const [name, value] of params) if (!RESERVED.has(name)) pairs.push([name, value])
  return sortFilterQuery(pairs)
}
