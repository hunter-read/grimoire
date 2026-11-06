// The thumb index: the letter rail beside a long list, and the runs of the list
// each letter jumps to.
//
// A list is cut into contiguous runs that share a key - a first letter for a
// name sort, a decade for a year sort, a month for a date-added sort - and the
// rail draws one tab per run. Only keys that hold something appear: an empty
// letter is left out rather than drawn dimmed. When the rail is too short for a
// tab per run, neighbouring small runs merge into ranges ("U–Z") so no tab
// shrinks below a usable target.

/** One run of the list, as the rail and the section headings draw it. */
export interface IndexEntry {
  /** Unique within the list; also names the section's heading anchor. */
  key: string
  /** What the tab shows ("T", "#", "1990s"). */
  label: string
  /** Rows in the run (systems, folders, items). */
  count: number
  /** What the rows hold, when that differs (the maps inside the folders). */
  units?: number
  /** The first few names in the run, for the rail's preview. */
  preview: string[]
  /** Where the run starts in a server-paged list. */
  offset?: number
}

/** One tab on the rail: a single run, or neighbouring runs merged. */
export interface RailTab extends IndexEntry {
  /** Every entry key the tab covers, first to last. */
  keys: string[]
}

/** A run of the list with its rows, for drawing the sections themselves. */
export interface IndexRun<T> extends IndexEntry {
  items: T[]
}

// Smallest tab the rail draws, in px: the WCAG 2.5.8 minimum target.
export const MIN_TAB = 24
// Largest, so a short index does not stretch a handful of letters down the page.
export const MAX_TAB = 32

// How many names a tab previews.
const PREVIEW = 4

/**
 * The rail letter for `name`: its first letter or digit, accents folded and
 * upper-cased in `locale`, with digits and symbols together under `#`.
 *
 * "Mörk Borg" files under M and "Élan" under E, which is also where the
 * library's locale-aware sort puts them, so every letter is one contiguous run.
 * A name in another script keeps its own first letter.
 */
export function indexLetter(name: string | null | undefined, locale?: string): string {
  const folded = (name || '').normalize('NFKD').replace(/\p{M}/gu, '')
  const first = folded.match(/[\p{L}\p{N}]/u)?.[0]
  if (!first || /\p{N}/u.test(first)) return '#'
  return first.toLocaleUpperCase(locale)
}

/** The decade a year falls in, as a rail key ("1990s"); "#" when unknown. */
export function decadeKey(year: number | null | undefined): string {
  if (year == null || !Number.isFinite(year)) return '#'
  return `${Math.floor(year / 10) * 10}s`
}

/**
 * `items` (already in display order) cut into runs of the same key.
 *
 * A key that turns up again after a different one starts a run of its own
 * rather than being merged back - the runs are the list's own order, which is
 * what a jump has to land in. Repeated keys are made unique (`#`, `#~1`).
 */
export function buildRuns<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  { nameOf, unitsOf }: { nameOf?: (item: T) => string; unitsOf?: (item: T) => number } = {}
): IndexRun<T>[] {
  const runs: IndexRun<T>[] = []
  const seen = new Map<string, number>()
  for (const item of items) {
    const label = keyOf(item)
    let run = runs[runs.length - 1]
    if (!run || run.label !== label) {
      const repeat = seen.get(label) || 0
      seen.set(label, repeat + 1)
      run = {
        key: repeat ? `${label}~${repeat}` : label,
        label,
        count: 0,
        preview: [],
        items: [],
        ...(unitsOf ? { units: 0 } : null),
      }
      runs.push(run)
    }
    run.items.push(item)
    run.count += 1
    if (unitsOf) run.units = (run.units || 0) + unitsOf(item)
    if (nameOf && run.preview.length < PREVIEW) run.preview.push(nameOf(item))
  }
  return runs
}

/** A merged tab's label: "U–Z", or the one label when it is a single run. */
function rangeLabel(first: string, last: string): string {
  return first === last ? first : `${first}–${last}`
}

/**
 * The entries as at most `maxTabs` rail tabs.
 *
 * While there are too many, the neighbouring pair holding the fewest rows
 * merges - so sparse letters (Q, X, Y, Z) fold into ranges first and the busy
 * ones keep a tab of their own.
 */
export function mergeTabs(entries: readonly IndexEntry[], maxTabs: number): RailTab[] {
  const tabs: RailTab[] = entries.map((e) => ({ ...e, keys: [e.key], preview: [...e.preview] }))
  const limit = Math.max(1, Math.floor(maxTabs))
  while (tabs.length > limit) {
    let best = 0
    for (let i = 1; i < tabs.length - 1; i++) {
      if (tabs[i].count + tabs[i + 1].count < tabs[best].count + tabs[best + 1].count) best = i
    }
    const a = tabs[best]
    const b = tabs[best + 1]
    const firstLabel = a.label.split('–')[0]
    const lastLabel = b.label.split('–').pop() || b.label
    tabs.splice(best, 2, {
      key: a.key,
      label: rangeLabel(firstLabel, lastLabel),
      count: a.count + b.count,
      ...(a.units !== undefined || b.units !== undefined
        ? { units: (a.units || 0) + (b.units || 0) }
        : null),
      preview: [...a.preview, ...b.preview].slice(0, PREVIEW),
      offset: a.offset,
      keys: [...a.keys, ...b.keys],
    })
  }
  return tabs
}

/** Tab height for `count` tabs in `space` px, kept between MIN_TAB and MAX_TAB. */
export function tabHeight(space: number, count: number): number {
  if (count <= 0) return MAX_TAB
  return Math.max(MIN_TAB, Math.min(MAX_TAB, Math.floor(space / count)))
}

/** The id of a run's section heading, which the rail's links point at. */
export function sectionId(scope: string, key: string): string {
  return `idx-${scope}-${encodeURIComponent(key).replace(/%/g, '_')}`
}

/**
 * Whether typing `char` should move to `tab`: it is the tab's letter, or falls
 * inside a merged range ("U–Z" answers to W).
 */
export function tabMatches(tab: Pick<RailTab, 'label'>, char: string, locale?: string): boolean {
  const c = indexLetter(char, locale)
  const [first, last = first] = tab.label.split('–')
  if (first === c || last === c) return true
  if (first.length !== 1 || last.length !== 1) return false
  return first.localeCompare(c, locale) <= 0 && c.localeCompare(last, locale) <= 0
}
