import { createContext } from 'react'
import { evaluate, parse } from './expressions'
import type { ExprContext, ExprNode } from './expressions'

/**
 * The sheet as its formulas read it - field values with their defaults,
 * computed values, resolved entries - for a control drawn deep inside it that
 * needs the character: a catalog browser working out each entry's
 * `entry_note`. Provided where the sheet is drawn, so FieldRenderer and the
 * pickers it delegates to stay free of the character they belong to.
 */
export const SheetFormulaContext = createContext<ExprContext | null>(null)

const FAILED = Symbol('failed')

/** A catalog entry as a note's formula reads it: its properties, name and id. */
export function noteEntry(entry: {
  entry_id: string
  source?: string
  name?: string
  data?: unknown
}): ExprContext {
  const data = entry.data && typeof entry.data === 'object' && !Array.isArray(entry.data)
  return {
    ...(data ? (entry.data as ExprContext) : {}),
    name: entry.name,
    _ref: entry.entry_id,
    _source: entry.source,
  }
}

/** A field's `entry_note`, parsed once; null when it has none or it does not parse. */
export function parseEntryNote(source: unknown): ExprNode | null {
  if (typeof source !== 'string' || !source.trim()) return null
  try {
    return parse(source)
  } catch {
    return null
  }
}

/**
 * The note shown beside one entry: the formula's text, worked out against the
 * sheet with the candidate as `entry`. An empty or failed result, or one that
 * is not text or a number, shows nothing.
 */
export function entryNoteText(
  note: ExprNode | null,
  entry: ExprContext,
  context: ExprContext | null
): string {
  if (!note) return ''
  const value = evaluate<symbol>(note, { ...(context || {}), entry }, FAILED)
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  return typeof value === 'string' ? value.trim() : ''
}
