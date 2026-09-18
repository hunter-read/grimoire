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
  min: (...args) => (args.length ? Math.min(...args.map(toNumber)) : 0),
  max: (...args) => (args.length ? Math.max(...args.map(toNumber)) : 0),
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
      const args = node[2].map((arg) => evalNode(arg, context))
      try {
        return FUNCTIONS[node[1]](...args)
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

export function computeValues(document, data) {
  const computed = document?.computed
  if (!computed || typeof computed !== 'object') return {}

  const fields = document.fields || {}
  const context = {}
  for (const [name, definition] of Object.entries(fields)) {
    if (Object.prototype.hasOwnProperty.call(data || {}, name)) context[name] = data[name]
    else if (definition && 'default' in definition) context[name] = definition.default
    else context[name] = definition?.type === 'text' ? '' : 0
  }
  for (const [key, value] of Object.entries(data || {})) {
    if (!(key in context)) context[key] = value
  }

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
