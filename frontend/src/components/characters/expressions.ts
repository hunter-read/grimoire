// The character sheet formula language, mirroring backend/services/characters/
// expressions.py. Both exist on purpose: the server is the authority (it
// validates schemas and computes values on read), and this one recomputes
// locally as you type so a modifier updates the instant its score changes,
// without a round trip per keystroke.
//
// Like the server's, it is a parser and a walker — never `eval`, never `new
// Function`. A schema comes from a stranger, so a formula is data that gets
// interpreted, not code that gets run.
//
// Keep the two in step: a change here almost always needs the same change
// there, and the shared test cases are the check on that.

import type { ValidatorResult } from './ValidatorMessages'

export class ExpressionError extends Error {}

/**
 * A value a formula reads or produces. Sheet data is JSON, so this is JSON
 * plus `undefined` (a missing argument).
 */
export type ExprValue =
  number | string | boolean | null | undefined | ExprValue[] | { [key: string]: ExprValue }

/** One row of a `list` field, or one resolved catalog entry. */
type Row = { [key: string]: ExprValue }

/** The values a formula's names resolve against, keyed by field name. */
export type ExprContext = Record<string, unknown>

type Token =
  | ['num', number]
  | ['str', string]
  | ['name', string]
  | ['op', string]
  | ['lit', boolean | null]
  | ['end', null]

type ComparisonOp = '==' | '!=' | '<' | '<=' | '>' | '>='
type ArithmeticOp = '+' | '-' | '*' | '/' | '%'

/** A parsed formula: a tagged tuple per node kind. */
export type ExprNode =
  | ['const', number | string | boolean | null]
  | ['name', string[]]
  | ['neg', ExprNode]
  | ['not', ExprNode]
  | ['and', ExprNode, ExprNode]
  | ['or', ExprNode, ExprNode]
  | ['cond', ExprNode, ExprNode, ExprNode]
  | ['compare', ComparisonOp, ExprNode, ExprNode]
  | ['binary', ArithmeticOp, ExprNode, ExprNode]
  | ['call', FunctionName, ExprNode[]]

type ExprFunction = (...args: ExprValue[]) => ExprValue

const TOKEN_RE =
  /\s+|(\d+\.\d+|\d+)|('[^']*'|"[^"]*")|([A-Za-z_][A-Za-z0-9_]*)|(<=|>=|==|!=|&&|\|\||[-+*/%<>(),?:.])/y

const WORD_OPS: Record<string, string> = { and: '&&', or: '||', not: 'not' }
const KEYWORDS: Record<string, boolean | null> = { true: true, false: false, null: null }
const COMPARISONS = new Set<string>(['==', '!=', '<', '<=', '>', '>='])

function tokenise(source: string): Token[] {
  const tokens: Token[] = []
  TOKEN_RE.lastIndex = 0
  let pos = 0
  while (pos < source.length) {
    TOKEN_RE.lastIndex = pos
    const match = TOKEN_RE.exec(source)
    if (!match) throw new ExpressionError(`Unexpected character at ${pos}`)
    pos = TOKEN_RE.lastIndex
    const [, number, string, name, op] = match
    if (number !== undefined) tokens.push(['num', Number(number)])
    else if (string !== undefined) tokens.push(['str', string.slice(1, -1)])
    else if (name !== undefined) {
      const lowered = name.toLowerCase()
      if (lowered in WORD_OPS) tokens.push(['op', WORD_OPS[lowered]])
      else if (lowered in KEYWORDS) tokens.push(['lit', KEYWORDS[lowered]])
      else tokens.push(['name', name])
    } else if (op !== undefined) tokens.push(['op', op])
    // else: whitespace, skipped
  }
  tokens.push(['end', null])
  return tokens
}

// --- values ---------------------------------------------------------------
// A sheet is edited in place and routinely half-filled, so every nonsense state
// reads as 0 rather than throwing. A sheet that shows "0" while you fill it in
// is far more useful than one that refuses to draw.

export function toNumber(value: unknown): number {
  if (value === true) return 1
  if (value === false) return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return 0
    const parsed = Number(text)
    return Number.isFinite(parsed) ? parsed : 0
  }
  if (Array.isArray(value)) return value.length
  if (value && typeof value === 'object') return Object.keys(value).length
  return 0
}

function truthy(value: unknown): boolean {
  if (typeof value === 'string') {
    const text = value.trim()
    return !!text && text !== '0' && text !== 'false' && text !== 'False'
  }
  if (Array.isArray(value)) return value.length > 0
  if (value && typeof value === 'object') return Object.keys(value).length > 0
  return !!toNumber(value)
}

const FUNCTIONS = {
  floor: (v: ExprValue) => Math.floor(toNumber(v)),
  ceil: (v: ExprValue) => Math.ceil(toNumber(v)),
  round: (v: ExprValue, digits: ExprValue = 0) => {
    const places = toNumber(digits)
    const factor = 10 ** places
    const result = Math.round(toNumber(v) * factor) / factor
    return places === 0 ? Math.round(toNumber(v)) : result
  },
  abs: (v: ExprValue) => Math.abs(toNumber(v)),
  // min/max accept both min(a, b, c) and min(list): `column(equipment, 'qty')`
  // yields a list, and max(column(...)) should give the largest quantity rather
  // than the number of rows.
  min: (...args: ExprValue[]) => {
    const flat = flatten(args)
    return flat.length ? Math.min(...flat.map(toNumber)) : 0
  },
  max: (...args: ExprValue[]) => {
    const flat = flatten(args)
    return flat.length ? Math.max(...flat.map(toNumber)) : 0
  },
  sum: (...args: ExprValue[]) =>
    args.reduce<number>(
      (total, v) =>
        total + (Array.isArray(v) ? v.reduce<number>((a, b) => a + toNumber(b), 0) : toNumber(v)),
      0
    ),
  len: (v: ExprValue) => {
    if (Array.isArray(v) || typeof v === 'string') return v.length
    if (v && typeof v === 'object') return Object.keys(v).length
    return 0
  },
  if: (condition: ExprValue, whenTrue: ExprValue, whenFalse: ExprValue) =>
    truthy(condition) ? whenTrue : whenFalse,
  clamp: (v: ExprValue, low: ExprValue, high: ExprValue) =>
    Math.max(toNumber(low), Math.min(toNumber(high), toNumber(v))),
  // How a character sheet prints a modifier: +3, -1, +0.
  signed: (v: ExprValue) => {
    const number = toNumber(v)
    return number >= 0 ? `+${number}` : String(number)
  },

  // Join values as text: concat(level, 'd', ref(klass, 'hit_die')) is "5d8".
  // `+` stays arithmetic; building a string is this function's job alone.
  // Capped to match the server, which is the authority on stored values.
  concat: (...values: ExprValue[]) =>
    values
      .filter((value) => value !== null && value !== undefined && value !== false)
      .map((value) => String(value))
      .join('')
      .slice(0, 1000),

  // --- list functions -----------------------------------------------------
  // A `list` field is a list of row objects, so these read a column out of
  // every row. The column name arrives as a *string* — count_where(equipment,
  // 'equipped', true) — because a bare name would resolve against the
  // character before the function ever saw it.
  count_where: (rows: ExprValue, column: ExprValue, expected: ExprValue = true) =>
    listRows(rows).filter((row) => equal(row[String(column)], expected)).length,

  sum_where: (
    rows: ExprValue,
    column: ExprValue,
    where: ExprValue = null,
    expected: ExprValue = true
  ) => {
    const key = String(column)
    const filterKey = where === null || where === undefined ? null : String(where)
    return listRows(rows).reduce<number>((total, row) => {
      if (filterKey !== null && !equal(row[filterKey], expected)) return total
      return total + toNumber(row[key])
    }, 0)
  },

  any_where: (rows: ExprValue, column: ExprValue, expected: ExprValue = true) =>
    listRows(rows).some((row) => equal(row[String(column)], expected)),

  // Every value of one column, for passing to sum()/min()/max().
  column: (rows: ExprValue, column: ExprValue) => listRows(rows).map((row) => row[String(column)]),

  // --- catalog functions --------------------------------------------------
  // A content_ref/content_list value is a reference — {_ref, _source, _per} —
  // not a copy of the entry. Reading an entry's own properties needs the
  // resolved entry, which arrives in the context as `_entries` and is passed to
  // these behind the scenes, so an author writes `ref(klass, 'hit_die')`.

  // Missing reads as '' rather than 0, for an unpicked reference and for a
  // property the entry lacks alike. '' coerces to 0 in arithmetic, so a sum is
  // unaffected, while `ref(klass, 'x') != ''` answers correctly — a 0 default
  // made every empty reference compare as a non-empty string.
  ref: (value: ExprValue, prop: ExprValue, entries: ExprValue) => {
    const found = resolveRefs(value, entries)
    if (!found.length) return ''
    return found[0][String(prop)] ?? ''
  },

  sum_refs: (value: ExprValue, prop: ExprValue, entries: ExprValue) =>
    resolveRefs(value, entries).reduce<number>(
      (total, entry) => total + toNumber(entry[String(prop)]),
      0
    ),

  has_ref: (value: ExprValue, entryId: ExprValue) => {
    const items = Array.isArray(value) ? value : [value]
    const wanted = String(entryId).trim().toLowerCase()
    return items.some(
      (item) =>
        item &&
        typeof item === 'object' &&
        String((item as Row)._ref ?? '')
          .trim()
          .toLowerCase() === wanted
    )
  },

  count_refs: (
    value: ExprValue,
    prop: ExprValue = null,
    expected: ExprValue = true,
    entries: ExprValue = undefined
  ) => {
    if (prop === null || prop === undefined) {
      const items = Array.isArray(value) ? value : []
      return items.filter((item) => item && typeof item === 'object').length
    }
    const key = String(prop)
    return resolveRefs(value, entries).filter((entry) => equal(entry[key], expected)).length
  },

  // Total of a column times each row's quantity - carried weight, cargo mass.
  // Reads a `list` field's rows, or the entries a `content_list` picks with the
  // character's per-entry quantity on top. A blank quantity counts once, since
  // an item listed without a count is one item; a quantity of 0 counts as none.
  sum_qty: (
    value: ExprValue,
    column: ExprValue,
    qty: ExprValue = 'qty',
    entries: ExprValue = undefined
  ) => {
    const key = String(column)
    const qtyKey = String(qty)
    let rows: ExprValue[] = Array.isArray(value) ? value : []
    if (
      rows.some((row) => row && typeof row === 'object' && ('_ref' in row || (row as Row)._inline))
    ) {
      rows = resolveRefs(rows, entries)
    }
    return listRows(rows).reduce<number>((total, row) => {
      const count = row[qtyKey]
      const multiplier =
        count === null || count === undefined || String(count).trim() === '' ? 1 : toNumber(count)
      return total + toNumber(row[key]) * multiplier
    }, 0)
  },

  // Whether a multiselect (or any list) holds a value, or text contains it.
  contains: (haystack: ExprValue, needle: ExprValue) => {
    if (Array.isArray(haystack)) return haystack.some((item) => equal(item, needle))
    if (typeof haystack === 'string') {
      return haystack.toLowerCase().includes(String(needle).trim().toLowerCase())
    }
    return false
  },
}

type FunctionName = keyof typeof FUNCTIONS

// The same table, seen as what the walker calls: every function takes values
// and returns one.
const CALLABLE: Record<FunctionName, ExprFunction> = FUNCTIONS

function flatten(values: ExprValue[]): ExprValue[] {
  const flat: ExprValue[] = []
  for (const value of values) {
    if (Array.isArray(value)) flat.push(...value)
    else flat.push(value)
  }
  return flat
}

// Every entry a reference or list of references points at. An `_inline` entry
// carries its own values and resolves to itself; a reference resolves through
// the table, with the character's own per-entry notes layered on top so
// `count_refs(spells, 'prepared')` reads what the player set.
// Functions that read resolved catalog entries, and the position the entry
// table occupies in each one's parameter list.
const ENTRY_AWARE: Partial<Record<FunctionName, number>> = {
  ref: 3,
  sum_refs: 3,
  count_refs: 4,
  sum_qty: 4,
}

function resolveRefs(value: ExprValue, entries: ExprValue): Row[] {
  const items = Array.isArray(value) ? value : [value]
  const table = (entries && typeof entries === 'object' ? entries : {}) as Row
  const out: Row[] = []
  for (const rawItem of items) {
    if (!rawItem || typeof rawItem !== 'object') continue
    const item = rawItem as Row
    if (item._inline) {
      // A freeform entry's per-entry notes count as much as a picked one's - a
      // custom item's quantity, a homebrew spell marked prepared.
      out.push({ ...item, ...((item._per || {}) as Row) })
      continue
    }
    const entry = table[String(item._ref)]
    if (entry && typeof entry === 'object') {
      out.push({ ...(entry as Row), ...((item._per || {}) as Row) })
    }
  }
  return out
}

function listRows(value: ExprValue): Row[] {
  if (!Array.isArray(value)) return []
  return value.filter((row): row is Row => !!row && typeof row === 'object' && !Array.isArray(row))
}

// --- parser ---------------------------------------------------------------

function createParser(tokens: Token[]) {
  let pos = 0
  const peek = (): Token => tokens[pos]
  const take = (): Token => tokens[pos++]
  const atOp = (...ops: string[]): boolean => {
    const [kind, value] = peek()
    return kind === 'op' && ops.includes(value)
  }
  const expectOp = (op: string): void => {
    const [kind, value] = take()
    if (kind !== 'op' || value !== op) throw new ExpressionError(`Expected ${op}`)
  }

  function parseExpression(): ExprNode {
    const condition = parseOr()
    if (atOp('?')) {
      take()
      const whenTrue = parseExpression()
      expectOp(':')
      return ['cond', condition, whenTrue, parseExpression()]
    }
    return condition
  }

  function parseOr(): ExprNode {
    let node = parseAnd()
    while (atOp('||')) {
      take()
      node = ['or', node, parseAnd()]
    }
    return node
  }

  function parseAnd(): ExprNode {
    let node = parseNot()
    while (atOp('&&')) {
      take()
      node = ['and', node, parseNot()]
    }
    return node
  }

  function parseNot(): ExprNode {
    if (atOp('not')) {
      take()
      return ['not', parseNot()]
    }
    return parseComparison()
  }

  function parseComparison(): ExprNode {
    let node = parseAdditive()
    while (peek()[0] === 'op' && COMPARISONS.has(peek()[1] as string)) {
      const [, op] = take()
      node = ['compare', op as ComparisonOp, node, parseAdditive()]
    }
    return node
  }

  function parseAdditive(): ExprNode {
    let node = parseMultiplicative()
    while (atOp('+', '-')) {
      const [, op] = take()
      node = ['binary', op as ArithmeticOp, node, parseMultiplicative()]
    }
    return node
  }

  function parseMultiplicative(): ExprNode {
    let node = parseUnary()
    while (atOp('*', '/', '%')) {
      const [, op] = take()
      node = ['binary', op as ArithmeticOp, node, parseUnary()]
    }
    return node
  }

  function parseUnary(): ExprNode {
    if (atOp('-')) {
      take()
      return ['neg', parseUnary()]
    }
    if (atOp('+')) {
      take()
      return parseUnary()
    }
    return parsePrimary()
  }

  function parsePrimary(): ExprNode {
    const [kind, value] = take()

    if (kind === 'num' || kind === 'str' || kind === 'lit') return ['const', value]

    if (kind === 'op' && value === '(') {
      const node = parseExpression()
      expectOp(')')
      return node
    }

    if (kind === 'name') {
      if (atOp('(')) {
        take()
        const args: ExprNode[] = []
        if (!atOp(')')) {
          args.push(parseExpression())
          while (atOp(',')) {
            take()
            args.push(parseExpression())
          }
        }
        expectOp(')')
        const fn = value.toLowerCase()
        if (!Object.prototype.hasOwnProperty.call(FUNCTIONS, fn)) {
          throw new ExpressionError(`Unknown function ${value}`)
        }
        return ['call', fn as FunctionName, args]
      }
      // A dotted path reads a key out of a nested value. It is a path, not
      // property access: the walker only ever indexes plain objects, so
      // `x.constructor` resolves to 0 rather than reaching a JS internal.
      const path: string[] = [value]
      while (atOp('.')) {
        take()
        const [nextKind, nextValue] = take()
        if (nextKind !== 'name') throw new ExpressionError("Expected a name after '.'")
        path.push(nextValue)
      }
      return ['name', path]
    }

    throw new ExpressionError(`Unexpected ${value} in expression`)
  }

  return { parseExpression, peek }
}

export function parse(source: unknown): ExprNode {
  if (typeof source !== 'string' || !source.trim()) {
    throw new ExpressionError('Expression is empty')
  }
  const parser = createParser(tokenise(source))
  const node = parser.parseExpression()
  if (parser.peek()[0] !== 'end') throw new ExpressionError('Unexpected trailing input')
  return node
}

// --- evaluation -----------------------------------------------------------

function lookup(path: string[], context: unknown): ExprValue {
  let current: unknown = context
  for (const key of path) {
    // Own properties only: a path must not be able to walk up a prototype
    // chain and read something that is not sheet data.
    if (!current || typeof current !== 'object') return 0
    if (!Object.prototype.hasOwnProperty.call(current, key)) return 0
    current = (current as Record<string, unknown>)[key]
    if (current === null || current === undefined) return 0
  }
  return current as ExprValue
}

function equal(left: ExprValue, right: ExprValue): boolean {
  if (typeof left === 'string' || typeof right === 'string') {
    return String(left).trim().toLowerCase() === String(right).trim().toLowerCase()
  }
  return toNumber(left) === toNumber(right)
}

function evalNode(node: ExprNode, context: ExprContext | undefined): ExprValue {
  const [kind] = node

  switch (node[0]) {
    case 'const':
      return node[1]
    case 'name':
      return lookup(node[1], context)
    case 'neg':
      return -toNumber(evalNode(node[1], context))
    case 'not':
      return !truthy(evalNode(node[1], context))
    case 'and':
      return truthy(evalNode(node[1], context)) && truthy(evalNode(node[2], context))
    case 'or':
      return truthy(evalNode(node[1], context)) || truthy(evalNode(node[2], context))
    case 'cond':
      return evalNode(truthy(evalNode(node[1], context)) ? node[2] : node[3], context)
    case 'compare': {
      const op = node[1]
      const left = evalNode(node[2], context)
      const right = evalNode(node[3], context)
      if (op === '==') return equal(left, right)
      if (op === '!=') return !equal(left, right)
      const a = toNumber(left)
      const b = toNumber(right)
      if (op === '<') return a < b
      if (op === '<=') return a <= b
      if (op === '>') return a > b
      return a >= b
    }
    case 'call': {
      const name = node[1]
      const args = node[2].map((arg) => evalNode(arg, context))
      // The catalog functions need the resolved entries. JS has no keyword
      // arguments, so the gap is filled with `undefined` rather than null —
      // `undefined` lets each parameter's own default apply, where null would
      // override it (which is how count_refs(spells, 'prepared') came to count
      // entries whose `prepared` was null rather than true).
      const entryPosition = ENTRY_AWARE[name]
      if (entryPosition) {
        while (args.length < entryPosition - 1) args.push(undefined)
        args[entryPosition - 1] = context?._entries as ExprValue
      }
      try {
        return CALLABLE[name](...args)
      } catch {
        return 0
      }
    }
    case 'binary': {
      const op = node[1]
      const left = toNumber(evalNode(node[2], context))
      const right = toNumber(evalNode(node[3], context))
      if (op === '+') return left + right
      if (op === '-') return left - right
      if (op === '*') return left * right
      // Division by zero is routine on a half-filled sheet — see the note at
      // the top. Integer results stay integral so modifiers print cleanly.
      if (op === '/') return right === 0 ? 0 : left / right
      if (op === '%') return right === 0 ? 0 : left % right
      return 0
    }
    default:
      throw new ExpressionError(`Unsupported node ${kind}`)
  }
}

export function evaluate<F = number>(
  source: unknown,
  context?: ExprContext,
  fallback: F | number = 0
): ExprValue | F {
  let node: ExprNode
  try {
    node = Array.isArray(source) ? (source as ExprNode) : parse(source)
  } catch {
    return fallback
  }
  try {
    return evalNode(node, context)
  } catch {
    return fallback
  }
}

// A computed value may depend on another, and a schema author should not have
// to declare them in dependency order. Repeated passes until nothing changes is
// simpler than a topological sort and degrades gracefully on a cyclic schema
// rather than failing to render one.
const MAX_PASSES = 12

/** The parts of a field definition the formula language reads. */
interface ExpressionField {
  type?: string
  default?: unknown
  default_from?: unknown
  visible_if?: unknown
}

interface ExpressionValidator {
  rule?: unknown
  message?: string
  severity?: string
  field?: string | null
}

/** The parts of a schema document the formula language reads. */
export interface ExpressionDocument {
  fields?: Record<string, ExpressionField | null | undefined> | null
  computed?: unknown
  validators?: unknown
}

// What a field reads as when the character has no value for it. A list is an
// empty list rather than 0, so `len(equipment)` is 0 on a new sheet instead of
// counting a zero.
const EMPTY_BY_TYPE: Record<string, ExprValue> = {
  text: '',
  textarea: '',
  select: '',
  checkbox: false,
  multiselect: [],
  list: [],
}

// The value of every field, for evaluating formulas and conditions against.
// Mirrors `_build_context` in backend/services/characters/schema.py. A field
// with a `default_from` formula and no stored value takes the formula's result;
// presence in `data` is what marks a field as the player's, so once they set it
// their value wins and the formula stops applying. Deriving a value from the
// class or species is therefore a starting point, never a lock.
export function buildContext(
  document: ExpressionDocument | null | undefined,
  data: ExprContext | null | undefined
): ExprContext {
  const fields = document?.fields || {}
  const context: ExprContext = {}
  const deferred: Record<string, ExpressionField> = {}
  for (const [name, definition] of Object.entries(fields)) {
    if (Object.prototype.hasOwnProperty.call(data || {}, name)) {
      context[name] = data![name]
      continue
    }
    if (definition?.default_from) {
      // Held back: the formula may read another field, so it cannot run until
      // every plain value is in the context.
      deferred[name] = definition
      continue
    }
    if (definition && 'default' in definition) context[name] = definition.default
    else {
      const type = definition?.type || 'text'
      context[name] = type in EMPTY_BY_TYPE ? EMPTY_BY_TYPE[type] : 0
    }
  }
  // Anything stored that the schema no longer declares still resolves, so a
  // formula referring to a since-renamed field keeps working until it is fixed.
  for (const [key, value] of Object.entries(data || {})) {
    if (!(key in context)) context[key] = value
  }

  // Seeded empty first, so a `default_from` naming another deferred field reads
  // a defined value rather than an undefined one.
  for (const [name, definition] of Object.entries(deferred)) {
    const type = definition?.type || 'text'
    if (!(name in context)) context[name] = type in EMPTY_BY_TYPE ? EMPTY_BY_TYPE[type] : 0
  }
  for (const [name, definition] of Object.entries(deferred)) {
    let derived: unknown = evaluate(definition.default_from, context)
    if (derived === null || derived === undefined || derived === '') {
      const type = definition?.type || 'text'
      derived =
        'default' in definition
          ? definition.default
          : type in EMPTY_BY_TYPE
            ? EMPTY_BY_TYPE[type]
            : 0
    }
    context[name] = derived
  }
  return context
}

export const OVERRIDES_KEY = '_overrides'

// Mirrors `computed_overrides` in backend/services/characters/schema.py: the
// player's overrides of computed values, limited to names the schema computes.
export function computedOverrides(
  document: ExpressionDocument | null | undefined,
  data: ExprContext | null | undefined
): ExprContext {
  const computed = document?.computed
  const stored = data?.[OVERRIDES_KEY]
  if (!computed || typeof computed !== 'object' || !stored || typeof stored !== 'object') return {}
  return Object.fromEntries(Object.entries(stored).filter(([name]) => name in computed))
}

// An overridden value is used as-is and its formula never runs. It is in the
// context from the first pass, so everything depending on it follows.
export function computeValues(
  document: ExpressionDocument | null | undefined,
  data: ExprContext | null | undefined
): ExprContext {
  const computed = document?.computed
  if (!computed || typeof computed !== 'object') return {}

  const context = buildContext(document, data)
  const overrides = computedOverrides(document, data)

  const results: ExprContext = { ...overrides }
  Object.assign(context, overrides)
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    let changed = false
    for (const [name, definition] of Object.entries(computed)) {
      if (name in overrides) continue
      const formula = typeof definition === 'string' ? definition : definition?.formula
      const value = evaluate(formula, context)
      if (results[name] !== value) {
        results[name] = value
        context[name] = value
        changed = true
      }
    }
    if (!changed) break
  }
  return results
}

// A sentinel telling "this rule could not be evaluated" apart from "this rule
// returned something falsey" — the two must not be reported the same way.
const UNEVALUATED = Symbol('unevaluated')

/**
 * Evaluate a schema's validators, returning the ones that fired.
 *
 * A rule states what *should* be true, so a false result is the problem worth
 * reporting. A rule that cannot be evaluated is skipped rather than reported:
 * schema validation rejected unparseable rules at install, so reaching here
 * means a stored document drifted, and inventing a warning the author never
 * wrote would be worse than staying quiet.
 */
export function runValidators(
  document: ExpressionDocument | null | undefined,
  data: ExprContext | null | undefined
): ValidatorResult[] {
  const validators = document?.validators
  if (!Array.isArray(validators) || !validators.length) return []

  const context = { ...buildContext(document, data), ...computeValues(document, data) }

  const fired: ValidatorResult[] = []
  for (const entry of validators as unknown[]) {
    if (!entry || typeof entry !== 'object') continue
    const validator = entry as ExpressionValidator
    const rule = validator.rule
    if (typeof rule !== 'string') continue
    const outcome = evaluate(rule, context, UNEVALUATED)
    if (outcome === UNEVALUATED || truthy(outcome)) continue
    fired.push({
      rule,
      message: validator.message || '',
      severity: validator.severity === 'error' ? 'error' : 'warning',
      field: validator.field ?? null,
    })
  }
  return fired
}

/**
 * Which fields a `visible_if` currently shows, keyed by field name.
 *
 * Only fields declaring one appear; anything absent is always shown. A
 * condition that cannot be evaluated shows the field, because hiding part of a
 * sheet over a broken expression loses the player access to their own data.
 */
export function visibleFields(
  document: ExpressionDocument | null | undefined,
  data: ExprContext | null | undefined
): Record<string, boolean> {
  const fields = document?.fields || {}
  const context = { ...buildContext(document, data), ...computeValues(document, data) }

  const result: Record<string, boolean> = {}
  for (const [name, definition] of Object.entries(fields)) {
    if (definition?.visible_if) {
      result[name] = !!evaluate(definition.visible_if, context, true)
    }
  }
  return result
}

// Whether one `visible_if` passes, for a layout section or a directive.
export function isVisible(condition: unknown, context: ExprContext | undefined): boolean {
  if (!condition) return true
  return !!evaluate(condition, context, true)
}
