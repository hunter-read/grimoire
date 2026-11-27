import { evaluate, parse } from './expressions'
import type { ExprContext, ExprNode } from './expressions'
import { entryAnswer } from './sheetPrompts'
import type { EntryAnswer, PromptStep } from './sheetPrompts'
import type { BrowseEntries } from './promptStepShared'

/**
 * The catalog an `entry` or `entries` step chooses from, read once each time
 * the prompt opens and narrowed again at every answer.
 *
 * Reading and filtering are kept apart. The read asks the server for the
 * step's fixed `filters`, page by page, and two steps reading the same content
 * type with the same `filters` share it. The `filter` formula is worked out
 * here, against the answers as they stand, so an option whose prerequisite is
 * ticked in the same step shows at once and one whose prerequisite is unticked
 * goes.
 */

// The most catalog entries a step reads, in pages of the catalog's largest
// size. A feat list is a few hundred; a filter narrows the rest.
const ENTRY_PAGE_SIZE = 200
const ENTRY_MAX_PAGES = 10

const FAILED = Symbol('failed')

/** A step's read of the catalog: its entries, or why it could not be read. */
export type CatalogRead = EntryAnswer[] | { error: string }

/**
 * Which read of the catalog a step needs: its content type and its fixed
 * `filters`, in a stable order so the same filters written in another order
 * share the read. Undefined for a step that reads no catalog.
 */
export function catalogKey(step: PromptStep): string | undefined {
  if ((step.type !== 'entry' && step.type !== 'entries') || !step.content_type) return undefined
  const filters = Object.entries(step.filters || {})
    .map(([key, value]) => [key, String(value)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return JSON.stringify([step.content_type, filters])
}

/** Every entry of one content type the fixed `filters` let through, read in pages. */
export async function loadCatalog(step: PromptStep, browse: BrowseEntries): Promise<EntryAnswer[]> {
  const found: EntryAnswer[] = []
  const contentType = step.content_type || ''
  for (let page = 1; page <= ENTRY_MAX_PAGES; page += 1) {
    const result = await browse(contentType, step.filters || {}, page, ENTRY_PAGE_SIZE)
    const rows = result.entries || []
    for (const row of rows) found.push(entryAnswer(row))
    if (rows.length < ENTRY_PAGE_SIZE || page * ENTRY_PAGE_SIZE >= (result.total ?? 0)) break
  }
  return found
}

// Each `filter` is parsed once, however many entries and answers it is
// worked out for. One that does not parse is remembered as such.
const parsed = new Map<string, ExprNode | typeof FAILED>()

function filterNode(source: string): ExprNode | typeof FAILED {
  let node = parsed.get(source)
  if (node === undefined) {
    try {
      node = parse(source)
    } catch {
      node = FAILED
    }
    parsed.set(source, node)
  }
  return node
}

/**
 * Whether an entry passes a step's `filter`, read with the candidate as
 * `entry`. One that fails to work out is left out, and a `filter` that does
 * not parse lets nothing through.
 */
export function passesFilter(step: PromptStep, entry: EntryAnswer, context: ExprContext): boolean {
  if (!step.filter) return true
  const node = filterNode(step.filter)
  if (node === FAILED) return false
  const value = evaluate<symbol>(node, { ...context, entry }, FAILED)
  return value !== FAILED && Boolean(value)
}

/** The entries of a catalog read that a step's `filter` lets through. */
export function filterCatalog(
  step: PromptStep,
  catalog: EntryAnswer[],
  context: ExprContext
): EntryAnswer[] {
  return catalog.filter((entry) => passesFilter(step, entry, context))
}

/** An entry's identity: the same id from two sources is two entries. */
export function entryKey(entry: { _ref?: unknown; _source?: unknown }): string {
  return `${String(entry._source ?? '')}:${String(entry._ref ?? '')}`
}
