import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useSearchParams } from 'react-router-dom'
import useSortFilterState from './useSortFilterState'
import type { SavedFiltersResult } from './useSavedFilters'
import type { SortFilterState } from '../components/library/FilterModal'
import {
  decodeSortFilter,
  encodeSortFilter,
  sortFilterPart,
  sortFilterQuery,
  withSortFilter,
} from '../utils/urlSortFilter'

/**
 * useSortFilterState, mirrored into the address bar.
 *
 * An address that names a sort or filters opens the view that way, ahead of the
 * saved default; otherwise the view starts as useSortFilterState decides and
 * then writes what it shows into the address. Changes replace the history
 * entry rather than adding one - a keystroke in the search box is not a page -
 * and Back or Forward to an address with other filters applies them.
 */
export default function useUrlSortFilterState<S extends SortFilterState = SortFilterState>(
  key: string,
  saved: Pick<SavedFiltersResult, 'loaded' | 'defaultFilter'>,
  initial: S
): [S, Dispatch<SetStateAction<S>>] {
  const [searchParams, setSearchParams] = useSearchParams()
  const [fromUrl] = useState(() => decodeSortFilter(searchParams, initial) as S | null)
  const [state, setState] = useSortFilterState<S>(key, saved, fromUrl ?? initial, {
    seeded: fromUrl !== null,
  })
  // The sort/filter part of the address as last written or applied, so each
  // effect can tell its own change from one arriving from the other side.
  const synced = useRef<string | null>(null)
  const initialRef = useRef(initial)

  useEffect(() => {
    const pairs = encodeSortFilter(state, initialRef.current)
    const query = sortFilterQuery(pairs)
    synced.current = query
    if (query === sortFilterPart(searchParams)) return
    setSearchParams((prev) => withSortFilter(prev, pairs), { replace: true })
    // Written from the state only; the address side is the next effect's job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  useEffect(() => {
    const part = sortFilterPart(searchParams)
    if (part === synced.current) return
    synced.current = part
    setState((decodeSortFilter(searchParams, initialRef.current) as S | null) ?? initialRef.current)
    // Applied from the address only (Back/Forward, a link with other filters).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  return [state, setState]
}
