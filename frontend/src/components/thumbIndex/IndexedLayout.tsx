import { useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import ThumbIndex from './ThumbIndex'
import useScrollSpy from '../../hooks/useScrollSpy'
import jumpToSection from '../../utils/jumpToSection'
import { buildRuns, sectionId, type IndexRun, type RailTab } from '../../utils/thumbIndex'

// A list shorter than this, or with fewer runs, reads fine without an index: it
// gets neither the rail nor the letter headings.
export const MIN_INDEXED_ITEMS = 30
const MIN_RUNS = 3

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
  /** Prefix for the section heading ids. */
  scope: string
  /** The rail's landmark name: "Jump to systems by letter". */
  railLabel: string
  /** What a tab or section holds: "9 folders · 1,012 maps". */
  describe: (run: Pick<RailTab, 'count' | 'units'>) => string
  /** Section heading level, under the list's own heading. */
  headingLevel: 2 | 3
  /** A run's label as shown (a decade, a month). */
  formatLabel?: (label: string) => string
  /** Skip rendering sections far off screen (cheap rows like cards only). */
  lazySections?: boolean
  /** Renders a run's rows - or every row, when the list is not indexed. */
  renderItems: (items: T[], sectioned: boolean) => ReactNode
  /** Changes when the sections move without a scroll (a folder opened). */
  version?: unknown
}

/**
 * A long list cut into lettered sections with the thumb index beside it.
 *
 * Each run of rows sharing a key gets a heading ("T · 9 folders") that the
 * rail's letters jump to, and screen-reader users can move between with
 * heading navigation. A short list, or one whose sort has no landmarks (size,
 * page count), renders as it always did, with no rail.
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
  headingLevel,
  formatLabel = (l) => l,
  lazySections = false,
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
  // The runs as a stable string: callers rebuild their sorted rows on every
  // render, and the scroll listener should not be re-attached for that.
  const shape = runs.map((r) => `${r.key}:${r.count}`).join('|')
  const current = useScrollSpy(listRef, indexed, version ?? shape)

  if (!indexed) return <>{renderItems([...items], false)}</>

  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  return (
    <div className="indexed-layout">
      <div ref={listRef} className="indexed-layout__list">
        {runs.map((run) => {
          const id = sectionId(scope, run.key)
          return (
            <section
              key={run.key}
              aria-labelledby={id}
              className={lazySections ? 'index-section index-section--lazy' : 'index-section'}
            >
              <Heading id={id} data-index-key={run.key} tabIndex={-1} className="index-heading">
                {formatLabel(run.label)}
                <span className="index-heading__count">{describe(run)}</span>
              </Heading>
              {renderItems(run.items, true)}
            </section>
          )
        })}
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
