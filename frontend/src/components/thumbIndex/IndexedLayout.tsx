import { useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import ThumbIndex from './ThumbIndex'
import useScrollSpy from '../../hooks/useScrollSpy'
import jumpToSection from '../../utils/jumpToSection'
import { buildRuns, sectionId, type IndexRun, type RailTab } from '../../utils/thumbIndex'

// A list shorter than this, or with fewer runs, reads fine without an index: it
// gets no rail.
export const MIN_INDEXED_ITEMS = 30
const MIN_RUNS = 3

/** What the first row of a run carries, so the rail can find and link to it. */
export interface IndexAnchor {
  id: string
  'data-index-key': string
}

/** A row's anchor props when it starts a run, otherwise undefined. */
export type AnchorOf<T> = (item: T) => IndexAnchor | undefined

export interface IndexedLayoutProps<T> {
  /** The rows, already in display order. */
  items: readonly T[]
  /** A row's run key: its letter, decade, or month. */
  keyOf: (item: T) => string
  /** A row's name, for the rail's preview. */
  nameOf: (item: T) => string
  /** What a row holds (the maps in a folder), when the rail should total it. */
  unitsOf?: (item: T) => number
  /** Index this list at all (the sort has landmarks to jump between). */
  enabled: boolean
  /** Prefix for the anchor ids. */
  scope: string
  /** The rail's landmark name: "Jump to systems by letter". */
  railLabel: string
  /** What a tab holds: "9 folders · 1,012 maps". */
  describe: (run: Pick<RailTab, 'count' | 'units'>) => string
  /** A run's label as shown (a decade, a month). */
  formatLabel?: (label: string) => string
  /**
   * Renders every row as one list. Spread `anchorOf(item)` onto each row's
   * outermost element: the first row of each run gets the props the rail jumps
   * to, every other row gets nothing.
   */
  renderItems: (items: T[], anchorOf: AnchorOf<T>) => ReactNode
  /** Changes when the rows move without a scroll (a folder opened). */
  version?: unknown
}

const noAnchor = () => undefined

/**
 * A long list with the thumb index beside it.
 *
 * The list stays one continuous run of rows - no letter headings breaking it
 * up. The first row of each run (a letter, decade or month) is marked with
 * `data-index-key`, which is what the rail's tabs jump to and the scroll spy
 * reads to light up the current letter. A short list, or one whose sort has no
 * landmarks (size, page count), renders with no rail.
 */
export default function IndexedLayout<T>({
  items,
  keyOf,
  nameOf,
  unitsOf,
  enabled,
  scope,
  railLabel,
  describe,
  formatLabel = (l) => l,
  renderItems,
  version,
}: IndexedLayoutProps<T>) {
  const listRef = useRef<HTMLDivElement>(null)
  const runs: IndexRun<T>[] = useMemo(
    () => (enabled ? buildRuns(items, keyOf, { nameOf, unitsOf }) : []),
    // The accessor functions are inline at every call site; the rows and the
    // switch are what change the runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, enabled]
  )
  const indexed = enabled && items.length >= MIN_INDEXED_ITEMS && runs.length >= MIN_RUNS
  const anchors = useMemo(() => {
    const map = new Map<T, IndexAnchor>()
    for (const run of runs) {
      map.set(run.items[0], { id: sectionId(scope, run.key), 'data-index-key': run.key })
    }
    return map
  }, [runs, scope])
  // The runs as a stable string: callers rebuild their sorted rows on every
  // render, and the scroll listener should not be re-attached for that.
  const shape = runs.map((r) => `${r.key}:${r.count}`).join('|')
  const current = useScrollSpy(listRef, indexed, version ?? shape)

  if (!indexed) return <>{renderItems([...items], noAnchor)}</>

  return (
    <div className="indexed-layout">
      <div ref={listRef} className="indexed-layout__list">
        {renderItems([...items], (item) => anchors.get(item))}
      </div>
      <ThumbIndex
        entries={runs}
        current={current}
        onJump={(tab) => jumpToSection(listRef.current, tab.key)}
        label={railLabel}
        describe={describe}
        formatLabel={formatLabel}
        scope={scope}
      />
    </div>
  )
}
