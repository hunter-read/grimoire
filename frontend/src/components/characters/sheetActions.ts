import { evaluate } from './expressions'
import type { ExprContext } from './expressions'
import type { FieldDefinition } from './FieldRenderer'

/**
 * A sheet's `actions`: named buttons that change several values at once - a
 * rest that clears every "used" counter it recovers, a level gained as a new
 * row of a list. Each is data, checked by the server when the sheet is
 * installed (`_validate_actions`), and worked out here into one patch of the
 * character's values, saved like any edit the player makes by hand.
 *
 * Every formula reads the sheet as it stood when the button was pressed: the
 * steps do not see each other's writes, so their order only matters when two
 * write the same value - the later wins, and steps on the same list apply in
 * turn.
 */

type Values = Record<string, unknown>

export interface ActionStep {
  set?: string | Record<string, string>
  to?: string
  each?: string
  where?: string
  append?: string
  values?: Record<string, string>
  prompt?: string
}

export interface SheetAction {
  name: string
  label: string
  confirm?: string
  steps: ActionStep[]
}

interface ActionDocument {
  fields?: Record<string, FieldDefinition>
  [key: string]: unknown
}

// The most rows a list may hold, as the server's MAX_ROWS: an append past it
// would be refused with the whole save.
export const MAX_LIST_ROWS = 500

// Whatever a formula falls back to when it cannot be worked out. A write whose
// formula fails is skipped, rather than wiping the value with a 0.
const FAILED = Symbol('failed')

export function findAction(
  document: ActionDocument | null | undefined,
  name: string | undefined
): SheetAction | undefined {
  const actions = document?.actions
  if (!name || !Array.isArray(actions)) return undefined
  return (actions as SheetAction[]).find(
    (action) => action && typeof action === 'object' && action.name === name
  )
}

/**
 * The prompts an action opens once its writes are made, in order: a level
 * gained written as a row, then the window that asks for its hit points.
 */
export function actionPrompts(action: SheetAction | undefined): string[] {
  return (Array.isArray(action?.steps) ? action.steps : [])
    .filter((step) => step && typeof step === 'object' && typeof step.prompt === 'string')
    .map((step) => step.prompt as string)
}

function isRow(value: unknown): value is Values {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function work(source: unknown, context: ExprContext): unknown {
  return evaluate<symbol>(source, context, FAILED)
}

/**
 * The patch one press of `action` makes: field name → new value, lists
 * written whole. Fields no step changes are left out.
 */
export function planAction(
  action: SheetAction,
  {
    document,
    data,
    context,
    entries = {},
  }: {
    document: ActionDocument | null | undefined
    data: Values | undefined
    context: Values
    entries?: Record<string, unknown>
  }
): Values {
  const fields = document?.fields || {}
  const patch: Values = {}
  const table = (context?._entries || entries || {}) as Record<string, unknown>

  // The rows of a list as this press has left them so far.
  const rowsOf = (name: string): unknown[] => {
    const current = name in patch ? patch[name] : data?.[name]
    return Array.isArray(current) ? current : []
  }

  for (const step of Array.isArray(action?.steps) ? action.steps : []) {
    if (!step || typeof step !== 'object') continue

    if (typeof step.each === 'string') {
      const name = step.each
      const definition = fields[name]
      if (!definition || !['list', 'content_list'].includes(definition.type || '')) continue
      const isEntries = definition.type === 'content_list'
      const cells = isRow(step.set) ? (step.set as Record<string, string>) : {}
      // The rows as the sheet reads them: a list's `default_from` cells worked
      // out, a picked entry with the character's per-entry values on top.
      // A row this press appended has no worked-out copy yet: it is read as
      // written.
      const derived = name in patch ? undefined : context?.[name]
      let changed = false
      const next = rowsOf(name).map((raw, index) => {
        if (!isRow(raw)) return raw
        let row: Values
        if (isEntries) {
          const entry = raw._inline ? raw : table[String(raw._ref)]
          row = { ...(isRow(entry) ? entry : {}), ...((raw._per as Values | undefined) || {}) }
        } else {
          const worked = Array.isArray(derived) ? derived[index] : undefined
          row = isRow(worked) ? worked : raw
        }
        const rowContext = { ...context, row }
        if (step.where && !truthy(step.where, rowContext)) return raw
        const written: Values = {}
        for (const [key, source] of Object.entries(cells)) {
          const value = work(source, rowContext)
          if (value !== FAILED) written[key] = value
        }
        if (!Object.keys(written).length) return raw
        changed = true
        if (!isEntries) return { ...raw, ...written }
        return { ...raw, _per: { ...((raw._per as Values | undefined) || {}), ...written } }
      })
      if (changed) patch[name] = next
      continue
    }

    if (typeof step.append === 'string') {
      const name = step.append
      if (fields[name]?.type !== 'list') continue
      const rows = rowsOf(name)
      if (rows.length >= MAX_LIST_ROWS) continue
      const row: Values = {}
      for (const [key, source] of Object.entries(isRow(step.values) ? step.values : {})) {
        const value = work(source, context)
        if (value !== FAILED) row[key] = value
      }
      patch[name] = [...rows, row]
      continue
    }

    if (typeof step.set === 'string') {
      if (!fields[step.set]) continue
      const value = work(step.to, context)
      if (value !== FAILED) patch[step.set] = value
    }
  }
  return patch
}

// `where` as a condition: any truthy value picks the row, as a <g-if> reads
// its test. One that cannot be worked out picks nothing.
function truthy(source: string, context: ExprContext): boolean {
  const value = work(source, context)
  return value !== FAILED && Boolean(value)
}
