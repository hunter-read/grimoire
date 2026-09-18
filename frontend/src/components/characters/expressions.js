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

export class ExpressionError extends Error {}

const TOKEN_RE =
  /\s+|(\d+\.\d+|\d+)|('[^']*'|"[^"]*")|([A-Za-z_][A-Za-z0-9_]*)|(<=|>=|==|!=|&&|\|\||[-+*/%<>(),?:.])/y

const WORD_OPS = { and: '&&', or: '||', not: 'not' }
const KEYWORDS = { true: true, false: false, null: null }
const COMPARISONS = new Set(['==', '!=', '<', '<=', '>', '>='])

function tokenise(source) {
  const tokens = []
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

export function toNumber(value) {
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

function truthy(value) {
  if (typeof value === 'string') {
    const text = value.trim()
    return !!text && text !== '0' && text !== 'false' && text !== 'False'
  }
  if (Array.isArray(value)) return value.length > 0
  if (value && typeof value === 'object') return Object.keys(value).length > 0
  return !!toNumber(value)
}

const FUNCTIONS = {
  floor: (v) => Math.floor(toNumber(v)),
  ceil: (v) => Math.ceil(toNumber(v)),
  round: (v, digits = 0) => {
    const places = toNumber(digits)
    const factor = 10 ** places
    const result = Math.round(toNumber(v) * factor) / factor
    return places === 0 ? Math.round(toNumber(v)) : result
  },
  abs: (v) => Math.abs(toNumber(v)),
  // min/max accept both min(a, b, c) and min(list): `column(equipment, 'qty')`
  // yields a list, and max(column(...)) should give the largest quantity rather
  // than the number of rows.
  min: (...args) => {
    const flat = flatten(args)
    return flat.length ? Math.min(...flat.map(toNumber)) : 0
  },
  max: (...args) => {
    const flat = flatten(args)
    return flat.length ? Math.max(...flat.map(toNumber)) : 0
  },
  sum: (...args) =>
    args.reduce(
      (total, v) =>
        total + (Array.isArray(v) ? v.reduce((a, b) => a + toNumber(b), 0) : toNumber(v)),
      0
    ),
  len: (v) => {
    if (Array.isArray(v) || typeof v === 'string') return v.length
    if (v && typeof v === 'object') return Object.keys(v).length
    return 0
  },
  if: (condition, whenTrue, whenFalse) => (truthy(condition) ? whenTrue : whenFalse),
  clamp: (v, low, high) => Math.max(toNumber(low), Math.min(toNumber(high), toNumber(v))),
  // How a character sheet prints a modifier: +3, -1, +0.
  signed: (v) => {
    const number = toNumber(v)
    return number >= 0 ? `+${number}` : String(number)
  },

  // --- list functions -----------------------------------------------------
  // A `list` field is a list of row objects, so these read a column out of
  // every row. The column name arrives as a *string* — count_where(equipment,
  // 'equipped', true) — because a bare name would resolve against the
  // character before the function ever saw it.
  count_where: (rows, column, expected = true) =>
    listRows(rows).filter((row) => equal(row[String(column)], expected)).length,

  sum_where: (rows, column, where = null, expected = true) => {
    const key = String(column)
    const filterKey = where === null || where === undefined ? null : String(where)
    return listRows(rows).reduce((total, row) => {
      if (filterKey !== null && !equal(row[filterKey], expected)) return total
      return total + toNumber(row[key])
    }, 0)
  },

  any_where: (rows, column, expected = true) =>
    listRows(rows).some((row) => equal(row[String(column)], expected)),

  // Every value of one column, for passing to sum()/min()/max().
  column: (rows, column) => listRows(rows).map((row) => row[String(column)]),

  // --- catalog functions --------------------------------------------------
  // A content_ref/content_list value is a reference — {_ref, _source, _per} —
  // not a copy of the entry. Reading an entry's own properties needs the
  // resolved entry, which arrives in the context as `_entries` and is passed to
  // these behind the scenes, so an author writes `ref(klass, 'hit_die')`.

  ref: (value, prop, entries) => {
    const found = resolveRefs(value, entries)
    return found.length ? (found[0][String(prop)] ?? 0) : 0
  },

  sum_refs: (value, prop, entries) =>
    resolveRefs(value, entries).reduce((total, entry) => total + toNumber(entry[String(prop)]), 0),

  has_ref: (value, entryId) => {
    const items = Array.isArray(value) ? value : [value]
    const wanted = String(entryId).trim().toLowerCase()
    return items.some(
      (item) =>
        item &&
        typeof item === 'object' &&
        String(item._ref ?? '')
          .trim()
          .toLowerCase() === wanted
    )
  },

  count_refs: (value, prop = null, expected = true, entries = undefined) => {
    if (prop === null || prop === undefined) {
      const items = Array.isArray(value) ? value : []
      return items.filter((item) => item && typeof item === 'object').length
    }
    const key = String(prop)
    return resolveRefs(value, entries).filter((entry) => equal(entry[key], expected)).length
  },

  // Whether a multiselect (or any list) holds a value, or text contains it.
  contains: (haystack, needle) => {
    if (Array.isArray(haystack)) return haystack.some((item) => equal(item, needle))
    if (typeof haystack === 'string') {
      return haystack.toLowerCase().includes(String(needle).trim().toLowerCase())
    }
    return false
  },
}

function flatten(values) {
  const flat = []
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
const ENTRY_AWARE = { ref: 3, sum_refs: 3, count_refs: 4 }

function resolveRefs(value, entries) {
  const items = Array.isArray(value) ? value : [value]
  const table = entries && typeof entries === 'object' ? entries : {}
  const out = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    if (item._inline) {
      out.push(item)
      continue
    }
    const entry = table[String(item._ref)]
    if (entry && typeof entry === 'object') out.push({ ...entry, ...(item._per || {}) })
  }
  return out
}

function listRows(value) {
  if (!Array.isArray(value)) return []
  return value.filter((row) => row && typeof row === 'object' && !Array.isArray(row))
}

// --- parser ---------------------------------------------------------------

function createParser(tokens) {
  let pos = 0
  const peek = () => tokens[pos]
  const take = () => tokens[pos++]
  const atOp = (...ops) => {
    const [kind, value] = peek()
    return kind === 'op' && ops.includes(value)
  }
  const expectOp = (op) => {
    const [kind, value] = take()
    if (kind !== 'op' || value !== op) throw new ExpressionError(`Expected ${op}`)
  }

  function parseExpression() {
    const condition = parseOr()
    if (atOp('?')) {
      take()
      const whenTrue = parseExpression()
      expectOp(':')
      return ['cond', condition, whenTrue, parseExpression()]
    }
    return condition
  }

  function parseOr() {
    let node = parseAnd()
    while (atOp('||')) {
      take()
      node = ['or', node, parseAnd()]
    }
    return node
  }

  function parseAnd() {
    let node = parseNot()
    while (atOp('&&')) {
      take()
      node = ['and', node, parseNot()]
    }
    return node
  }

  function parseNot() {
    if (atOp('not')) {
      take()
      return ['not', parseNot()]
    }
    return parseComparison()
  }

  function parseComparison() {
    let node = parseAdditive()
    while (peek()[0] === 'op' && COMPARISONS.has(peek()[1])) {
      const [, op] = take()
      node = ['compare', op, node, parseAdditive()]
    }
    return node
  }

  function parseAdditive() {
    let node = parseMultiplicative()
    while (atOp('+', '-')) {
      const [, op] = take()
      node = ['binary', op, node, parseMultiplicative()]
    }
    return node
  }

  function parseMultiplicative() {
    let node = parseUnary()
    while (atOp('*', '/', '%')) {
      const [, op] = take()
      node = ['binary', op, node, parseUnary()]
    }
    return node
  }

  function parseUnary() {
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

  function parsePrimary() {
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
        const args = []
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
        return ['call', fn, args]
      }
      // A dotted path reads a key out of a nested value. It is a path, not
      // property access: the walker only ever indexes plain objects, so
      // `x.constructor` resolves to 0 rather than reaching a JS internal.
      const path = [value]
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

export function parse(source) {
  if (typeof source !== 'string' || !source.trim()) {
    throw new ExpressionError('Expression is empty')
  }
  const parser = createParser(tokenise(source))
  const node = parser.parseExpression()
  if (parser.peek()[0] !== 'end') throw new ExpressionError('Unexpected trailing input')
  return node
}

// --- evaluation -----------------------------------------------------------

function lookup(path, context) {
  let current = context
  for (const key of path) {
    // Own properties only: a path must not be able to walk up a prototype
    // chain and read something that is not sheet data.
    if (!current || typeof current !== 'object') return 0
    if (!Object.prototype.hasOwnProperty.call(current, key)) return 0
    current = current[key]
    if (current === null || current === undefined) return 0
  }
  return current
}

function equal(left, right) {
  if (typeof left === 'string' || typeof right === 'string') {
    return String(left).trim().toLowerCase() === String(right).trim().toLowerCase()
  }
  return toNumber(left) === toNumber(right)
}

function evalNode(node, context) {
  const [kind] = node

  switch (kind) {
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
      if (ENTRY_AWARE[name]) {
        while (args.length < ENTRY_AWARE[name] - 1) args.push(undefined)
        args[ENTRY_AWARE[name] - 1] = context?._entries
      }
      try {
        return FUNCTIONS[name](...args)
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

export function evaluate(source, context, fallback = 0) {
  let node
  try {
    node = Array.isArray(source) ? source : parse(source)
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

// What a field reads as when the character has no value for it. A list is an
// empty list rather than 0, so `len(equipment)` is 0 on a new sheet instead of
// counting a zero.
const EMPTY_BY_TYPE = {
  text: '',
  textarea: '',
  select: '',
  checkbox: false,
  multiselect: [],
  list: [],
}

// The value of every field, for evaluating formulas and conditions against.
export function buildContext(document, data) {
  const fields = document?.fields || {}
  const context = {}
  for (const [name, definition] of Object.entries(fields)) {
    if (Object.prototype.hasOwnProperty.call(data || {}, name)) context[name] = data[name]
    else if (definition && 'default' in definition) context[name] = definition.default
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
  return context
}

export function computeValues(document, data) {
  const computed = document?.computed
  if (!computed || typeof computed !== 'object') return {}

  const context = buildContext(document, data)

  const results = {}
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    let changed = false
    for (const [name, definition] of Object.entries(computed)) {
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
export function runValidators(document, data) {
  const validators = document?.validators
  if (!Array.isArray(validators) || !validators.length) return []

  const context = { ...buildContext(document, data), ...computeValues(document, data) }

  const fired = []
  for (const validator of validators) {
    if (!validator || typeof validator !== 'object') continue
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
export function visibleFields(document, data) {
  const fields = document?.fields || {}
  const context = { ...buildContext(document, data), ...computeValues(document, data) }

  const result = {}
  for (const [name, definition] of Object.entries(fields)) {
    if (definition?.visible_if) {
      result[name] = !!evaluate(definition.visible_if, context, true)
    }
  }
  return result
}

// Whether one `visible_if` passes, for a layout section or a directive.
export function isVisible(condition, context) {
  if (!condition) return true
  return !!evaluate(condition, context, true)
}
